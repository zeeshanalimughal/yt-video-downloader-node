import inquirer from 'inquirer';
import ytdl from '@distube/ytdl-core';
import fs from 'fs';
import path from 'path';
import cliProgress from 'cli-progress';
import { fileURLToPath } from 'url';
import cp from 'child_process';


function formatBytes(bytes, decimals = 2) {
    if (!bytes || isNaN(bytes)) return '0 B';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

function calculateSpeed(chunks, timeWindow = 3000) {
    const now = Date.now();
    while (chunks.length > 0 && chunks[0].time < now - timeWindow) {
        chunks.shift();
    }
    
    if (chunks.length === 0) return 0;
    
    const totalBytes = chunks.reduce((sum, chunk) => sum + chunk.bytes, 0);
    
    if (chunks.length === 1 || chunks[chunks.length - 1].time === chunks[0].time) {
        return totalBytes / (timeWindow / 1000);
    }
    
    const timeSpan = (chunks[chunks.length - 1].time - chunks[0].time) / 1000;
    return timeSpan > 0 ? totalBytes / timeSpan : totalBytes / (timeWindow / 1000);
}

function calculateEta(speed, remainingBytes) {
    if (speed <= 0 || remainingBytes <= 0 || !isFinite(speed) || !isFinite(remainingBytes)) {
        return 'calculating...';
    }
    
    const seconds = remainingBytes / speed;
    
    if (!isFinite(seconds) || seconds <= 0) {
        return 'calculating...';
    }
    
    if (seconds > 24 * 3600) {
        return '> 24h';
    }
    
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    const parts = [];
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);
    
    return parts.join(' ');
}

async function getAvailableQualities(url, downloadType) {
    try {
        const info = await ytdl.getInfo(url);
        
        if (downloadType === 'audio') {
            const formats = info.formats
                .filter(format => format.hasAudio && !format.hasVideo)
                .map(format => ({
                    quality: `${format.audioBitrate}kbps`,
                    itag: format.itag,
                    hasAudio: true,
                    hasVideo: false,
                    container: format.container,
                    audioBitrate: format.audioBitrate,
                    contentLength: format.contentLength
                }));

            return Array.from(new Map(formats.map(item =>
                [item.quality, item])).values()).sort((a, b) => b.audioBitrate - a.audioBitrate);
        }

        const formats = info.formats
            .filter(format => format.hasVideo && format.qualityLabel)
            .map(format => ({
                quality: format.qualityLabel,
                itag: format.itag,
                hasAudio: format.hasAudio,
                hasVideo: true,
                container: format.container,
                width: format.width,
                height: format.height,
                fps: format.fps,
                bitrate: format.bitrate,
                contentLength: format.contentLength
            }));

        const uniqueFormats = Array.from(new Map(formats.map(item =>
            [item.quality, item])).values());

        return uniqueFormats.sort((a, b) => {
            const aHeight = parseInt(a.height) || 0;
            const bHeight = parseInt(b.height) || 0;
            return bHeight - aHeight;
        });
    } catch (error) {
        console.error('Error getting video info:', error.message);
        throw error;
    }
}

async function streamDownload(url, options, outputFile, progress, format) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let downloadedBytes = 0;
        let totalSize = parseInt(format.contentLength) || 0;

        const writeStream = fs.createWriteStream(outputFile);
        const stream = ytdl(url, options);

        stream.on('error', (error) => {
            writeStream.end();
            reject(error);
        });

        writeStream.on('error', (error) => {
            stream.destroy();
            reject(error);
        });

        if (!totalSize) {
            stream.once('response', (res) => {
                totalSize = parseInt(res.headers['content-length']) || 0;
            });
        }

        stream.on('data', (chunk) => {
            downloadedBytes += chunk.length;
            chunks.push({ bytes: chunk.length, time: Date.now() });
            
            const speed = calculateSpeed(chunks);
            const percentage = totalSize ? Math.min(100, Math.floor((downloadedBytes / totalSize) * 100)) : 0;
            const remainingBytes = Math.max(0, totalSize - downloadedBytes);
            
            progress.update(percentage, {
                speed: formatBytes(Math.max(0, speed)),
                downloaded: `${formatBytes(downloadedBytes)}${totalSize ? ` / ${formatBytes(totalSize)}` : ''}`,
                eta: calculateEta(speed, remainingBytes)
            });

            writeStream.write(chunk);
        });

        stream.on('end', () => {
            writeStream.end();
        });

        writeStream.on('finish', () => {
            resolve(downloadedBytes);
        });
    });
}

async function downloadVideo(url, selectedQuality, downloadType) {
    try {
        const info = await ytdl.getInfo(url);
        const downloadsDir = path.join(process.cwd(), 'downloads');
        const tempDir = path.join(downloadsDir, '.temp');

        if (!fs.existsSync(downloadsDir)) {
            fs.mkdirSync(downloadsDir);
        }
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir);
        }

        const outputFile = path.join(downloadsDir, `${info.videoDetails.title.replace(/[^\w\s]/gi, '')}_${selectedQuality.quality}.${selectedQuality.container}`);
        const tempVideoFile = path.join(tempDir, `temp_video_${Date.now()}.${selectedQuality.container}`);
        const tempAudioFile = path.join(tempDir, `temp_audio_${Date.now()}.${selectedQuality.container}`);

        const multibar = new cliProgress.MultiBar({
            clearOnComplete: false,
            hideCursor: true,
            format: '{bar} {percentage}% | Speed: {speed} | {downloaded} | ETA: {eta}'
        }, cliProgress.Presets.shades_classic);

        const needsAudioMerge = downloadType !== 'video' && !selectedQuality.hasAudio;
        let audioFormat = null;

        if (needsAudioMerge) {
            audioFormat = ytdl.chooseFormat(info.formats, { 
                quality: 'highestaudio',
                filter: 'audioonly' 
            });
            
            if (!audioFormat) {
                throw new Error('No suitable audio format found');
            }
        }

        if (needsAudioMerge) {
            console.log('\nDownloading video...');
            const videoProgress = multibar.create(100, 0, { speed: "0 B", downloaded: "0 B", eta: "N/A" });
            
            await streamDownload(url, {
                quality: selectedQuality.itag,
                filter: 'videoonly'
            }, tempVideoFile, videoProgress, selectedQuality);

            console.log('\nDownloading audio...');
            const audioProgress = multibar.create(100, 0, { speed: "0 B", downloaded: "0 B", eta: "N/A" });
            
            await streamDownload(url, {
                quality: audioFormat.itag,
                filter: 'audioonly'
            }, tempAudioFile, audioProgress, audioFormat);

            multibar.stop();

            console.log('\nMerging video and audio...');
            await new Promise((resolve, reject) => {
                const ffmpeg = cp.spawn('ffmpeg', [
                    '-i', tempVideoFile,
                    '-i', tempAudioFile,
                    '-c:v', 'copy',
                    '-c:a', 'aac',
                    outputFile
                ]);

                let dots = 0;
                const progressInterval = setInterval(() => {
                    process.stdout.write('\r' + 'Merging' + '.'.repeat(dots));
                    dots = (dots + 1) % 4;
                }, 500);

                ffmpeg.on('close', (code) => {
                    clearInterval(progressInterval);
                    if (code === 0) {
                        console.log('\nMerge completed successfully');
                        resolve();
                    } else {
                        reject(new Error(`FFmpeg process exited with code ${code}`));
                    }
                });

                ffmpeg.on('error', (err) => {
                    clearInterval(progressInterval);
                    reject(err);
                });
            });

            try {
                fs.unlinkSync(tempVideoFile);
                fs.unlinkSync(tempAudioFile);
                const tempFiles = fs.readdirSync(tempDir);
                if (tempFiles.length === 0) {
                    fs.rmdirSync(tempDir);
                }
            } catch (err) {
                console.warn('Warning: Could not clean up some temporary files:', err.message);
            }
        } else {
            console.log('\nDownloading video with audio...');
            const progress = multibar.create(100, 0, { speed: "0 B", downloaded: "0 B", eta: "N/A" });
            
            await streamDownload(url, {
                quality: selectedQuality.itag,
                filter: downloadType === 'audio' ? 'audioonly' : 'audioandvideo'
            }, outputFile, progress, selectedQuality);

            multibar.stop();
        }

        console.log(`\nVideo saved to: ${outputFile}`);
        return outputFile;
    } catch (error) {
        throw error;
    }
}

async function selectQuality(qualities, downloadType) {
    const choices = qualities.map(q => ({
        name: downloadType === 'audio' 
            ? `Audio Quality: ${q.quality}`
            : `${q.quality} (${q.width}x${q.height}) @ ${q.fps}fps`,
        value: q
    }));

    const questions = [
        {
            type: 'list',
            name: 'format',
            message: `Select ${downloadType === 'audio' ? 'audio' : 'video'} quality:`,
            choices: [
                ...choices,
                { name: 'Highest Quality', value: 'highest' }
            ],
            pageSize: 10
        }
    ];

    const { format } = await inquirer.prompt(questions);
    return format;
}

async function selectDownloadType() {
    const questions = [
        {
            type: 'list',
            name: 'downloadType',
            message: 'What would you like to download?',
            choices: [
                { name: 'Video with Audio', value: 'both' },
                { name: 'Video Only', value: 'video-only' },
                { name: 'Audio Only', value: 'audio' }
            ]
        }
    ];

    const { downloadType } = await inquirer.prompt(questions);
    return downloadType;
}

async function main() {
    try {
        const url = process.argv[2];

        if (!url) {
            console.error('Please provide a YouTube URL');
            console.log('Usage: node index.js <YouTube URL>');
            process.exit(1);
        }

        const downloadType = await selectDownloadType();
        console.log('Fetching available qualities...');
        const qualities = await getAvailableQualities(url, downloadType);
        const selectedFormat = await selectQuality(qualities, downloadType);
        await downloadVideo(url, selectedFormat, downloadType);
    } catch (error) {
        console.error('Error:', error.message);
        process.exit(1);
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    main();
}