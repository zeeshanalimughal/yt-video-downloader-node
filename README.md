## Node.js YouTube Video Downloader

A node.js command-line tool to download YouTube videos with quality selection and audio support.

### Features

- Download videos in various qualities (144p to 4K)
- Download audio-only or video-only streams
- Automatic audio merging when needed
- Real-time progress tracking with speed and ETA
- Downloads stored in organized `downloads` folder

### Requirements

- Node.js
- FFmpeg (required for audio merging)
  - Install from [FFmpeg website](https://ffmpeg.org/download.html)

### Quick Start

1. Install dependencies:
   ```bash
   npm install
   ```

2. Run the app:
   ```bash
   node index.js <YouTube URL>
   ```

3. Follow the prompts to:
   - Select download type (video/audio/both)
   - Choose quality
   - Wait for download to complete

4. Find your video in the `downloads` folder

### Troubleshooting

- Make sure FFmpeg is installed and in your system PATH
- Check your internet connection if downloads fail
- Ensure you have enough disk space


### License
MIT License - Feel free to use and modify as needed.