FROM python:3.10-slim

# Install FFmpeg in the python base image
RUN apt-get update && apt-get install -y ffmpeg && apt-get clean && rm -rf /var/lib/apt/lists/*

# Set working directory inside container
WORKDIR /usr/src/app

# Copy requirement file
COPY requirements.txt ./

# Install required python packages
RUN pip install --no-cache-dir -r requirements.txt

# Copy the FFmpeg cacher script
COPY ffmpeg_warmer.py ./

CMD [ "python", "-u", "ffmpeg_warmer.py" ]
