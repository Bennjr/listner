import torch
print(torch.cuda.is_available())        # For NVIDIA (should be False on AMD)
print(torch.backends.mps.is_available()) # For Apple Silicon
print(torch.version.hip)                # AMD ROCm version
print(torch.device("cuda" if torch.cuda.is_available() else "hip"))