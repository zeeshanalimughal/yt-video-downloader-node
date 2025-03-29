# YouTube Video Downloader

A Node.js-based tool to download YouTube videos and playlists with quality selection and audio merging support.

## Features

- Download individual videos or entire playlists.
- Select video quality (e.g., 1080p, 720p, etc.).
- Automatically merges audio and video streams (requires FFmpeg).
- Organizes downloads into folders.

## Requirements

- Node.js
- `yt-dlp` (for batch playlist downloads)
- FFmpeg (for merging audio and video streams)

## Dependency on `yt-dlp`

This project relies entirely on the `yt-dlp` package for downloading videos and playlists. For more information about `yt-dlp`, visit their [GitHub repository](https://github.com/yt-dlp/yt-dlp).

## Setup

### Install `yt-dlp`

1. Download `yt-dlp` from the [official GitHub repository](https://github.com/yt-dlp/yt-dlp).
2. Place the executable in a directory of your choice (e.g., `C:\Users\myUsername\AppData\Local\Microsoft\WinGet\Packages\yt-dlp.yt-dlp_Microsoft.Winget.Source_8wekyb3d8bbwe\yt-dlp.exe`).

### Set the `YT_DLP_PATH` Environment Variable

1. Add the path to the `yt-dlp` executable as an environment variable:
   - On **Windows**:
     ```cmd
     set YT_DLP_PATH=C:\Users\myUsername\AppData\Local\Microsoft\WinGet\Packages\yt-dlp.yt-dlp_Microsoft.Winget.Source_8wekyb3d8bbwe\yt-dlp.exe
     ```
   - On **macOS/Linux**:
     ```bash
     export YT_DLP_PATH=/path/to/yt-dlp
     ```

2. Ensure the `YT_DLP_PATH` is accessible by running:
   ```bash
   echo %YT_DLP_PATH% # On Windows
   echo $YT_DLP_PATH  # On macOS/Linux
   ```

### Install FFmpeg

1. Download FFmpeg from the [official website](https://ffmpeg.org/download.html).
2. Add FFmpeg to your system's PATH:
     - Extract the FFmpeg zip file.
     - Copy the `bin` folder path (e.g., `C:\ffmpeg\bin`).
     - Add it to the system PATH via Environment Variables.

3. Verify the installation by running:
   ```bash
   ffmpeg -version
   ```

### Install Dependencies

Run the following command to install required Node.js dependencies:
```bash
npm install
```

## Usage

### Single Video Downloader (`index.js`)

The `index.js` script allows you to download a single YouTube video with options for video-only, audio-only, or both.

1. Run the script with a YouTube URL:
   ```bash
   node index.js <YouTube URL>
   ```

2. Follow the prompts to:
   - Select the download type (video with audio, video-only, or audio-only).
   - Choose the desired quality.

3. The downloaded file will be saved in the `downloads` folder.

### Batch Playlist Downloader (`batch-playlist-downloader.js`)

The `batch-playlist-downloader.js` script allows you to download multiple playlists in bulk.

1. Prepare a playlist file:
   - **JSON format**:
     ```json
     [
       {
         "folderName": "MyPlaylist1",
         "playlistLink": "https://www.youtube.com/playlist?list=..."
       },
       {
         "folderName": "MyPlaylist2",
         "playlistLink": "https://www.youtube.com/playlist?list=..."
       }
     ]
     ```
   - **Text format**:
     ```
     https://www.youtube.com/playlist?list=...
     https://www.youtube.com/playlist?list=...
     ```

2. Run the script:
   ```bash
   node batch-playlist-downloader.js
   ```

3. Follow the prompts to:
   - Select the playlist file type (JSON or text).
   - Provide the path to the playlist file.
   - Choose the maximum video quality (e.g., 1080p, 720p, etc.).

4. The downloaded videos will be saved in the `downloads` folder, organized by playlist.

### Troubleshooting

- Ensure the `YT_DLP_PATH` environment variable is correctly set for batch playlist downloads.
- Verify that `yt-dlp` and FFmpeg are installed and accessible.
- Check your internet connection if downloads fail.
- Ensure you have enough disk space for large downloads.

## License

MIT License - Feel free to use and modify as needed.