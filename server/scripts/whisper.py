import whisper

def transcribe(filepath):
    model = whisper.load_model("base")
    result = model.transcribe("audio.mp3")
    print(result["text"])
