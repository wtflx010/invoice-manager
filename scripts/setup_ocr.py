#!/usr/bin/env python3
"""Setup PaddleOCR dependencies and pre-download models."""
import subprocess
import sys
import json
import platform
import struct


def run_pip(args):
    return subprocess.run(
        [sys.executable, '-m', 'pip', 'install'] + args,
        capture_output=True, text=True, timeout=600
    )


def check_import(name):
    try:
        __import__(name)
        return True
    except Exception:
        return False


def is_paddle_broken():
    """Check if paddle is installed but has architecture mismatch."""
    try:
        import paddle
        # Try to actually use paddle (not just import)
        _ = paddle.__version__
        return False
    except Exception:
        # paddle exists but can't load - likely architecture mismatch
        try:
            import importlib.util
            spec = importlib.util.find_spec('paddle')
            if spec is not None:
                return True
        except Exception:
            pass
        return False


def get_python_arch():
    """Get the architecture of the current Python process."""
    return platform.machine() or struct.calcsize("P") * 8


def main():
    steps = []
    all_ok = True
    python_arch = get_python_arch()

    # Step 1: Install paddlepaddle (CPU version)
    paddle_broken = is_paddle_broken()
    if paddle_broken:
        steps.append({
            'step': 'paddlepaddle',
            'status': 'reinstalling',
            'reason': f'架构不兼容 (Python: {python_arch})，正在重新安装...'
        })
        try:
            # Uninstall first, then reinstall
            run_pip(['uninstall', 'paddlepaddle', '-y'])
            result = run_pip(['paddlepaddle', '--quiet', '--force-reinstall'])
            if result.returncode == 0 and check_import('paddle'):
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
                    'error': result.stderr.strip()[-300:] if result.stderr else 'install failed'
                })
                all_ok = False
        except Exception as e:
            steps.append({'step': 'paddlepaddle', 'status': 'failed', 'error': str(e)})
            all_ok = False
    elif check_import('paddle'):
        try:
            import paddle
            _ = paddle.__version__
            steps.append({
                'step': 'paddlepaddle',
                'status': 'already_installed',
                'version': getattr(paddle, '__version__', 'unknown')
            })
        except Exception:
            # Import succeeded but usage failed - reinstall
            steps.append({
                'step': 'paddlepaddle',
                'status': 'reinstalling',
                'reason': 'paddle加载异常，正在重新安装...'
            })
            try:
                run_pip(['uninstall', 'paddlepaddle', '-y'])
                result = run_pip(['paddlepaddle', '--quiet', '--force-reinstall'])
                if result.returncode == 0 and check_import('paddle'):
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
                        'error': result.stderr.strip()[-300:] if result.stderr else 'install failed'
                    })
                    all_ok = False
            except Exception as e:
                steps.append({'step': 'paddlepaddle', 'status': 'failed', 'error': str(e)})
                all_ok = False
    else:
        try:
            result = run_pip(['paddlepaddle', '--quiet'])
            if result.returncode == 0 and check_import('paddle'):
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
                    'error': result.stderr.strip()[-300:] if result.stderr else 'install failed'
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
    if check_import('paddleocr') and check_import('paddle'):
        try:
            from paddleocr import PaddleOCR
            import os
            os.environ['DISABLE_MODEL_SOURCE_CHECK'] = 'True'
            ocr = PaddleOCR(lang='ch', use_angle_cls=True)
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
