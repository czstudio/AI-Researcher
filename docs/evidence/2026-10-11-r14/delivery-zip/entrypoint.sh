#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export CUDA_VISIBLE_DEVICES=""
export OMP_NUM_THREADS=1 MKL_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1
mkdir -p "$ROOT/results"
printf 'Batch Normalization reproduction: CPU-only. Project: %s\n' "$ROOT"
# Use the existing runtime; never create a virtual environment.
if ! python3 -m pip --version; then
  python3 - "$ROOT" <<'PY'
import os, pathlib, subprocess, sys, urllib.request
root=pathlib.Path(sys.argv[1])
bootstrap=root/'sources/get-pip.py'
bootstrap.parent.mkdir(parents=True,exist_ok=True)
urllib.request.urlretrieve('https://bootstrap.pypa.io/get-pip.py',bootstrap)
command=[sys.executable,str(bootstrap)]
if os.environ.get('PIP_TARGET'): command += ['--target',os.environ['PIP_TARGET']]
subprocess.check_call(command)
PY
fi
if ! python3 -c "import torch; assert torch.__version__=='2.5.1+cpu'"; then
  python3 -m pip install 'torch==2.5.1' --index-url https://download.pytorch.org/whl/cpu
fi
if ! python3 -c "import numpy,matplotlib,PIL; assert numpy.__version__=='2.4.6'; assert matplotlib.__version__=='3.11.1'; assert PIL.__version__=='12.3.0'"; then
  python3 -m pip install 'numpy==2.4.6' 'matplotlib==3.11.1' 'pillow==12.3.0'
fi
python3 -m pip freeze > "$ROOT/results/environment_freeze.txt"
python3 -m unittest discover -s "$ROOT/tests" -v 2>&1 | tee "$ROOT/results/tests.log"
python3 "$ROOT/src/data.py" --dataset all 2>&1 | tee "$ROOT/results/data_preparation_latest.log"
python3 "$ROOT/src/run_experiments.py" "$@" 2>&1 | tee "$ROOT/results/orchestration.log"
python3 "$ROOT/src/validate_results.py" 2>&1 | tee "$ROOT/results/validation.log"
python3 "$ROOT/src/analyze.py"
printf '\nCompleted: %s/results/fidelity_report.md\n' "$ROOT"
