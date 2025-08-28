import whisper


model = whisper.load_model("base")
result = model.transcribe(filepath)
print(result["text"])