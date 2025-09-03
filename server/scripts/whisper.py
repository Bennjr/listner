import sys
import wave
from pathlib import Path
import openai_whisper as whisper
import datetime

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python whisper.py <audio_file>")
        sys.exit(1)

    audio_path = sys.argv[1]
    print(f"Processing PCM file: {audio_path}")

    with open(audio_path, 'rb') as pcm_file:
        pcm_data = pcm_file.read()

    wav_name = Path(audio_path).stem + ".wav"
    wav_path = Path(f"server/chunks/audio/{datetime.datetime.now().strftime('%Y-%m-%d')}/wav") / wav_name
    wav_path.parent.mkdir(parents=True, exist_ok=True)

    with wave.open(str(wav_path), 'wb') as wav_file:
        wav_file.setnchannels(2)    
        wav_file.setsampwidth(2)    
        wav_file.setframerate(48000)  
        wav_file.writeframes(pcm_data)
    
    print(f"Converted to WAV: {wav_path}")
    
    model = whisper.load_model("base")
    result = model.transcribe(str(wav_path))

    stripped_userID = ""
    stripped_sessionID = ""

    raw_file = Path(f"server/transcriptions/{datetime.datetime.now().strftime('%Y-%m-%d')}/{stripped_sessionID}/{stripped_userID}") / wav_path.stem
    raw_file = raw_file.with_suffix(".txt")
    raw_file.parent.mkdir(parents=True, exist_ok=True)
    with open(raw_file, "a", encoding="utf-8") as f:
        f.write(result["text"] + "\n"+ "\n")