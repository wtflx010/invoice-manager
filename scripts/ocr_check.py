#!/usr/bin/env python3
"""Check if PaddleOCR is installed and ready."""
import json


def check_import(name):
    try:
        __import__(name)
        return True, ''
    except ImportError:
        return False, ''


def main():
    paddle_ok, _ = check_import('paddle')
    ocr_ok, _ = check_import('paddleocr')
    pdf2img_ok, _ = check_import('pdf2image')

    ready = paddle_ok and ocr_ok

    result = {
        'ready': ready,
        'version': 'PaddleOCR',
        'components': {
            'paddlepaddle': paddle_ok,
            'paddleocr': ocr_ok,
            'pdf2image': pdf2img_ok
        }
    }

    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()