#!/usr/bin/env python3
"""Setup PaddleOCR dependencies and pre-download models."""
import subprocess
import sys
import json


def run_pip(args):
    return subprocess.run(
        [sys.executable, '-m', 'pip', 'install'] + args,
        capture_output=True, text=True, timeout=600
    )


def check_import(name):
    try:
        __import__(name)
        return True
    except ImportError:
        return False


def main():
    steps = []
    all_ok = True

    # Step 1: Install paddlepaddle (CPU version for smaller footprint)
    if check_import('paddle'):
        import paddle
        steps.append({
            'step': 'paddlepaddle',
            'status': 'already_installed',
            'version': getattr(paddle, '__version__', 'unknown')
        })
    else:
        try:
            result = run_pip(['paddlepaddle', '--quiet'])
            if result.returncode == 0:
                import paddle
                steps.append({
                    'step': 'paddlepaddle',
                    'status': 'installed',
                    'version': getattr(paddle, '__version__', 'unknown')
                })
            else:
                steps.append({
                    'step': 'paddlepaddle',
                    'status': 'failed',
                    'error': result.stderr.strip()[-200:]
                })
                all_ok = False
        except Exception as e:
            steps.append({'step': 'paddlepaddle', 'status': 'failed', 'error': str(e)})
            all_ok = False

    # Step 2: Install paddleocr
    if check_import('paddleocr'):
        steps.append({'step': 'paddleocr', 'status': 'already_installed'})
    else:
        try:
            result = run_pip(['paddleocr', '--quiet'])
            if result.returncode == 0:
                steps.append({'step': 'paddleocr', 'status': 'installed'})
            else:
                steps.append({
                    'step': 'paddleocr',
                    'status': 'failed',
                    'error': result.stderr.strip()[-200:]
                })
                all_ok = False
        except Exception as e:
            steps.append({'step': 'paddleocr', 'status': 'failed', 'error': str(e)})
            all_ok = False

    # Step 3: Install pdf2image (for PDF support)
    if check_import('pdf2image'):
        steps.append({'step': 'pdf2image', 'status': 'already_installed'})
    else:
        try:
            result = run_pip(['pdf2image', '--quiet'])
            if result.returncode == 0:
                steps.append({'step': 'pdf2image', 'status': 'installed'})
            else:
                steps.append({
                    'step': 'pdf2image',
                    'status': 'failed',
                    'error': result.stderr.strip()[-200:]
                })
        except Exception as e:
            steps.append({'step': 'pdf2image', 'status': 'failed', 'error': str(e)})

    # Step 4: Pre-download models by initializing PaddleOCR once
    if check_import('paddleocr'):
        try:
            from paddleocr import PaddleOCR
            import os
            os.environ['DISABLE_MODEL_SOURCE_CHECK'] = 'True'
            ocr = PaddleOCR(lang='ch', use_angle_cls=True, show_log=False)
            steps.append({'step': 'model_download', 'status': 'completed'})
        except Exception as e:
            steps.append({'step': 'model_download', 'status': 'failed', 'error': str(e)[:200]})
            all_ok = False

    print(json.dumps({
        'success': all_ok,
        'steps': steps
    }, ensure_ascii=False))


if __name__ == '__main__':
    main()