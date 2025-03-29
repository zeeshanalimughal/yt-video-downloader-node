import inquirer from 'inquirer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import readline from 'readline';

const YT_DLP_PATH = process.env.YT_DLP_PATH;

if (!YT_DLP_PATH) {
    console.error('Error: YT_DLP_PATH environment variable is not set. Please set it to the path of yt-dlp executable.');
    process.exit(1);
}

async function readPlaylistsFromJson(jsonPath) {
    try {
        const jsonContent = fs.readFileSync(jsonPath, 'utf8');
        return JSON.parse(jsonContent);
    } catch (error) {
        console.error('Error reading JSON file:', error.message);
        return null;
    }
}

async function readPlaylistsFromText(textPath) {
    const playlists = [];
    try {
        const fileStream = fs.createReadStream(textPath);
        const rl = readline.createInterface({
            input: fileStream,
            crlfDelay: Infinity
        });

        let index = 1;
        for await (const line of rl) {
            if (line.trim()) {
                playlists.push({
                    folderName: `playlist-${index}`,
                    playlistLink: line.trim()
                });
                index++;
            }
        }
        return playlists;
    } catch (error) {
        console.error('Error reading text file:', error.message);
        return null;
    }
}

function spawnPromise(command, args, options = {}) {
    return new Promise((resolve, reject) => {
        const process = spawn(command, args, options);
        let stdout = '';
        let stderr = '';

        process.stdout.on('data', (data) => {
            const text = data.toString();
            stdout += text;
            try {
                if (text.includes('[download]')) {
                    process.stdout.write('\r' + text.trim());
                } else {
                    console.log(text.trim());
                }
            } catch (err) {
            }
        });

        process.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        process.on('close', (code) => {
            if (code === 0 || (stderr.includes('Merging formats into') && fs.existsSync(options.outputFile))) {
                resolve(stdout);
            } else {
                reject(new Error('Process failed with code ' + code + ': ' + stderr));
            }
        });

        process.on('error', (err) => {
            if (err.code === 'EPIPE') {
                if (options.outputFile && fs.existsSync(options.outputFile) && fs.statSync(options.outputFile).size > 0) {
                    resolve(stdout);
                } else {
                    reject(err);
                }
            } else {
                reject(err);
            }
        });
    });
}

async function downloadVideo(url, options, outputTemplate) {
    const maxRetries = 3;
    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            if (attempt > 1) {
                console.log('Retry attempt ' + attempt + '/' + maxRetries + '...');
                await new Promise(resolve => setTimeout(resolve, attempt * 2000));
            }

            return await spawnPromise(YT_DLP_PATH, options, { outputFile: outputTemplate });
        } catch (error) {
            lastError = error;
            if (attempt === maxRetries) {
                throw new Error('Failed after ' + maxRetries + ' attempts: ' + error.message);
            }
        }
    }
}

async function getAvailableFormats(videoUrl) {
    try {
        const args = [
            '--list-formats',
            '--no-warnings',
            videoUrl
        ];

        const output = await new Promise((resolve, reject) => {
            const process = spawn(YT_DLP_PATH, args);
            let stdout = '';
            let stderr = '';

            process.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            process.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            process.on('close', (code) => {
                if (code === 0) {
                    resolve(stdout);
                } else {
                    reject(new Error(stderr || 'Failed to get formats'));
                }
            });
        });

        // Parse formats from output
        const formats = new Set();
        const lines = output.split('\n');
        for (const line of lines) {
            if (line.includes('mp4')) {
                const match = line.match(/\b(\d+)p\b/);
                if (match) {
                    formats.add(parseInt(match[1]));
                }
            }
        }

        return Array.from(formats).sort((a, b) => b - a);
    } catch (error) {
        console.error('Error getting formats:', error.message);
        return [];
    }
}

async function downloadSingleVideo(videoUrl, outputTemplate, selectedQuality, index, total) {
    try {
        // Add a small delay between videos
        await new Promise(resolve => setTimeout(resolve, 2000));

        console.log('\nProcessing video ' + index + '/' + total + '...');

        // Check if file already exists
        try {
            const infoArgs = [
                '--get-filename',
                '-o', outputTemplate,
                '--restrict-filenames',
                videoUrl
            ];
            const filename = await spawnPromise(YT_DLP_PATH, infoArgs, { outputFile: outputTemplate });
            const finalFilename = filename.trim();

            if (fs.existsSync(finalFilename)) {
                console.log('File already exists: ' + path.basename(finalFilename) + ', skipping...');
                return true;
            }
        } catch (error) {
            console.log('Could not check filename, attempting download...');
        }

        // Get available formats for this video
        const availableFormats = await getAvailableFormats(videoUrl);
        console.log('Available formats for this video:', availableFormats.map(f => f + 'p').join(', '));

        // Find the best format that's less than or equal to selected quality
        let bestFormat = availableFormats.find(f => f <= selectedQuality) || Math.min(...availableFormats);
        console.log('Selected format:', bestFormat + 'p');

        const formatString = `bestvideo[height=${bestFormat}][ext=mp4]+bestaudio[ext=m4a]/best[height=${bestFormat}][ext=mp4]/bestvideo[height<=${bestFormat}]+bestaudio/best[height<=${bestFormat}]`;

        const downloadArgs = [
            '--format', formatString,
            '--output', outputTemplate,
            '--restrict-filenames',
            '--no-playlist',
            '--no-mtime',
            '--force-ipv4',
            '--retries', '3',
            '--fragment-retries', '3',
            '--retry-sleep', '5',
            '--merge-output-format', 'mp4',
            '--no-keep-video',
            '--no-keep-fragments',
            '--prefer-ffmpeg',
            '--no-check-certificates',
            '--buffer-size', '8K',
            '--no-part',
            '--no-cache-dir',
            '--no-progress',
            '--quiet',
            videoUrl
        ];

        try {
            await downloadVideo(videoUrl, downloadArgs, outputTemplate);
            
            // Verify the file exists and has content
            if (fs.existsSync(outputTemplate)) {
                const stats = fs.statSync(outputTemplate);
                if (stats.size > 0) {
                    console.log('\nVideo ' + index + ' download and merge completed');
                    return true;
                }
            }
            
            throw new Error('Download completed but file verification failed');
        } catch (error) {
            if (error.code === 'EPIPE') {
                // Check if the file exists and has content despite the EPIPE error
                const possibleFiles = [
                    outputTemplate,
                    outputTemplate.replace('.mp4', '.mkv'),
                    outputTemplate.replace('.mp4', '.webm')
                ];

                for (const file of possibleFiles) {
                    if (fs.existsSync(file)) {
                        const stats = fs.statSync(file);
                        if (stats.size > 0) {
                            console.log('\nVideo ' + index + ' downloaded successfully despite EPIPE error');
                            return true;
                        }
                    }
                }
            }

            console.error('Failed to download video ' + index + ': ' + error.message);
            
            try {
                console.log('Trying fallback format...');
                await new Promise(resolve => setTimeout(resolve, 3000));

                const fallbackArgs = [
                    '--format', 'best',
                    '--output', outputTemplate,
                    '--restrict-filenames',
                    '--no-playlist',
                    '--no-mtime',
                    '--force-ipv4',
                    '--retries', '3',
                    '--fragment-retries', '3',
                    '--retry-sleep', '5',
                    '--merge-output-format', 'mp4',
                    '--no-keep-video',
                    '--no-keep-fragments',
                    '--prefer-ffmpeg',
                    '--no-check-certificates',
                    '--buffer-size', '8K',
                    '--no-part',
                    '--no-cache-dir',
                    '--no-progress',
                    '--quiet',
                    videoUrl
                ];

                await downloadVideo(videoUrl, fallbackArgs, outputTemplate);
                
                // Verify the fallback download
                if (fs.existsSync(outputTemplate)) {
                    const stats = fs.statSync(outputTemplate);
                    if (stats.size > 0) {
                        console.log('\nVideo ' + index + ' download completed with fallback format');
                        return true;
                    }
                }
                
                throw new Error('Fallback download completed but file verification failed');
            } catch (fallbackError) {
                console.error('Failed to download video ' + index + ' with fallback format: ' + fallbackError.message);
                return false;
            }
        }
    } catch (error) {
        console.error('Fatal error downloading video ' + index + ': ' + error.message);
        return false;
    }
}

async function downloadPlaylist(playlistUrl, selectedQuality, folderName) {
    try {
        // Create downloads directory with custom folder name
        const downloadsBaseDir = path.join(process.cwd(), 'downloads');
        if (!fs.existsSync(downloadsBaseDir)) {
            fs.mkdirSync(downloadsBaseDir);
        }

        const playlistDir = path.join(downloadsBaseDir, folderName);
        if (!fs.existsSync(playlistDir)) {
            fs.mkdirSync(playlistDir);
        }

        console.log('\nProcessing Playlist: ' + folderName);
        console.log('Getting playlist information...');
        
        const infoArgs = [
            '--dump-single-json',
            '--no-warning',
            '--playlist-items', '1-1000',
            '--flat-playlist',
            playlistUrl
        ];

        const playlistInfo = await new Promise((resolve, reject) => {
            const process = spawn(YT_DLP_PATH, infoArgs);
            let output = '';

            process.stdout.on('data', (data) => {
                output += data.toString();
            });

            process.stderr.on('data', (data) => {
            });

            process.on('close', (code) => {
                if (code === 0 && output.trim()) {
                    try {
                        const info = JSON.parse(output);
                        resolve(info);
                    } catch (e) {
                        reject(new Error('Failed to parse playlist info'));
                    }
                } else {
                    reject(new Error('Failed to get playlist info'));
                }
            });
        });

        if (!playlistInfo.entries || !playlistInfo.entries.length) {
            throw new Error('No videos found in playlist');
        }

        const videos = playlistInfo.entries;
        console.log('Found ' + videos.length + ' videos in playlist: ' + folderName);
        console.log('Starting downloads...\n');

        // Download videos one by one
        const total = videos.length;
        let failedVideos = 0;

        for (let i = 0; i < videos.length; i++) {
            const video = videos[i];
            const videoUrl = 'https://www.youtube.com/watch?v=' + video.id;
            const outputTemplate = path.join(playlistDir, (i + 1) + '-%(title).50s.mp4');

            const success = await downloadSingleVideo(videoUrl, outputTemplate, selectedQuality, i + 1, total);
            if (!success) {
                failedVideos++;
            }

            if (i < videos.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }

        if (failedVideos > 0) {
            console.log('\nFailed to download ' + failedVideos + ' videos from playlist: ' + folderName);
        }

        console.log('\nPlaylist ' + folderName + ' downloads completed!');
    } catch (error) {
        console.error('Error processing playlist: ' + folderName + ': ' + error.message);
        throw error;
    }
}

async function main() {
    try {
        const { fileType } = await inquirer.prompt([
            {
                type: 'list',
                name: 'fileType',
                message: 'Select playlist file type:',
                choices: ['JSON (with custom folders)', 'Text (numbered folders)']
            }
        ]);

        const { filePath } = await inquirer.prompt([
            {
                type: 'input',
                name: 'filePath',
                message: 'Enter the path to your playlist file (json or txt):',
                default: fileType === 'JSON (with custom folders)' ? 'playlists.json' : 'playlists.txt'
            }
        ]);

        let playlists;
        if (fileType === 'JSON (with custom folders)') {
            playlists = await readPlaylistsFromJson(filePath);
        } else {
            playlists = await readPlaylistsFromText(filePath);
        }

        if (!playlists || playlists.length === 0) {
            throw new Error('No playlists found in the file');
        }

        const { quality } = await inquirer.prompt([
            {
                type: 'list',
                name: 'quality',
                message: 'Select maximum video quality:',
                choices: [
                    { name: '1080p', value: 1080 },
                    { name: '720p', value: 720 },
                    { name: '480p', value: 480 },
                    { name: '360p', value: 360 },
                    { name: '240p', value: 240 }
                ]
            }
        ]);

        console.log('\nStarting downloads...');
        console.log('Total playlists:', playlists.length);

        for (let i = 0; i < playlists.length; i++) {
            const playlist = playlists[i];
            console.log('\n========================================');
            console.log('Processing playlist ' + (i + 1) + ' of ' + playlists.length);
            console.log('URL:', playlist.playlistLink);
            console.log('Folder:', playlist.folderName);
            console.log('========================================\n');

            try {
                await downloadPlaylist(playlist.playlistLink, quality, playlist.folderName);
            } catch (error) {
                console.error('Failed to process playlist ' + (i + 1) + ': ' + error.message);
                console.log('Continuing with next playlist...\n');
            }
        }

        console.log('\nAll playlists have been processed!');
    } catch (error) {
        console.error('Error:', error.message);
        process.exit(1);
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    main();
}
