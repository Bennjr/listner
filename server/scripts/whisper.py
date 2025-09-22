from asyncio.proactor_events import base_events
import sys
from pathlib import Path
from faster_whisper import WhisperModel
import datetime
import subprocess
import os
import json


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
    print("We got to the start of the whisper.py")

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
        # Convert PCM to MP3
        mp3_file = convert(chunk_file, cleanup_pcm=True)
        
        # Load Whisper model and transcribe
        print("Trying to load the model")
        model = WhisperModel("medium", device="auto")  
        print("Model loaded, starting transcription")

        segments, info = model.transcribe(
            mp3_file,
            initial_prompt="Bibel studie, forvent bok navn og navn i Bibelen",
            language="no"
        )

        transcribed_text = "".join(segment.text for segment in segments)
        print("Transcription finished")

        result = {
            "text": transcribed_text,
            "created_at": datetime.datetime.now().isoformat(),
            "user_id": user_id,
            "username": username,
            "session_id": session_id
        }

        # Get basepath from metadata
        with open("server/metadata.json", "r") as f:
            metadata = json.load(f)
            basepath = metadata["basepath"]

        if not basepath:
            print("Error: basepath missing in metadata.json")
            sys.exit(1)

        # Save user transcription
        user_json = os.path.join(basepath, "users", user_id, "transcriptions.json")
        try:
            if os.path.exists(user_json):
                with open(user_json, "r", encoding="utf-8") as f:
                    existing_data = json.load(f)
                    if not isinstance(existing_data, list):
                        existing_data = [existing_data]
            else:
                existing_data = []

            existing_data.append(result)

            with open(user_json, "w", encoding="utf-8") as f:
                json.dump(existing_data, f, indent=2, ensure_ascii=False)
            print(f"Saved user transcription to: {user_json}")
        except Exception as e:
            print(f"Error saving user JSON: {e}")

        # Save to archive files
        archive_dir = os.path.join(basepath, "archive")
        os.makedirs(archive_dir, exist_ok=True)

        # Append to mixed text file
        mixed_text = os.path.join(archive_dir, "mixed.txt")
        try:
            with open(mixed_text, "a", encoding="utf-8") as f:
                timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                f.write(f"[{timestamp}] {username}: {transcribed_text}\n\n")
            print(f"Appended to mixed text file: {mixed_text}")
        except Exception as e:
            print(f"Error writing to mixed text file: {e}")

        # Save to mixed JSON
        mixed_json = os.path.join(archive_dir, "mixed_transcriptions.json")
        try:
            if os.path.exists(mixed_json):
                with open(mixed_json, "r", encoding="utf-8") as f:
                    existing_mixed = json.load(f)
                    if not isinstance(existing_mixed, list):
                        existing_mixed = [existing_mixed]
            else:
                existing_mixed = []

            existing_mixed.append(result)

            with open(mixed_json, "w", encoding="utf-8") as f:
                json.dump(existing_mixed, f, indent=2, ensure_ascii=False)
            print(f"Saved to mixed JSON: {mixed_json}")
        except Exception as e:
            print(f"Error saving mixed JSON: {e}")

        print("Transcription process completed successfully")
        print(json.dumps(result, ensure_ascii=False))
        sys.exit(0)

    except Exception as e:
        print(f"Error during transcription: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)