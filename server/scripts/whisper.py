import sys
from pathlib import Path
import openai_whisper as whisper
import datetime
import subprocess
import os

def convert(pcm_file, mp3_file=None, cleanup_pcm=True):
    if mp3_file is None:
        mp3_file = Path(pcm_file).with_suffix('.mp3')
    
    try:
        cmd = [
            'ffmpeg',
            '-y',  
            '-f', 's16le',  
            '-ar', '48000', 
            '-ac', '2', 
            '-i', str(pcm_file), 
            '-codec:a', 'libmp3lame', 
            '-b:a', '128k', 
            '-loglevel', 'error', 
            str(mp3_file) 
        ]

        print(f"Converting {pcm_file} to {mp3_file}")
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)

        if os.path.exists(mp3_file) and os.path.getsize(mp3_file) > 0:
            print(f"Succesfully converted: {mp3_file}")

            if cleanup_pcm:
                os.remove(pcm_file)
                print(f"Removed {pcm_file}")
            return str(mp3_file)
        else:
            raise Exception("MP3 file does not exist or is empty")
    except subprocess.CalledProcessError as e:
        print(f"FFmpeg error: {e}")
        raise
    except Exception as e:
        print(f"Error converting {pcm_file}: {e}")
        raise
    

if __name__ == "__main__":
    if len(sys.argv) < 5:
        print("Usage: python whisper.py <chunk_file> <user_id> <username> <session_id>")
        sys.exit(1)

    chunk_file = sys.argv[1] 
    user_id = sys.argv[2]       
    username = sys.argv[3]        
    session_id = sys.argv[4]

    if not os.path.exists(chunk_file):
        print(f"Chunk file {chunk_file} does not exist")
        sys.exit(1)
    
    try:
        mp3_file = convert(chunk_file, cleanup_pcm=True)
    except Exception as e:
        print(f"Error converting {chunk_file}: {e}")
        sys.exit(1)
    
    try:
        model = whisper.load_model("base")
        result = model.transcribe(
            mp3_file,
            initial_prompt="Bibel studie, forvent bok navn og navn i Bibelen",
            language="no"
        )
    except Exception as e:
        print(f"Error transcribing {mp3_file}: {e}")
        sys.exit(1)