#!/usr/bin/env python3
"""PaddleOCR-based invoice text extraction. Handles PDF and images."""
import sys
import json
import os
import tempfile


def main():
    if len(sys.argv) < 2:
        print(json.dumps({'success': False, 'error': 'Missing file path'}))
        sys.exit(1)

    file_path = sys.argv[1]
    if not os.path.exists(file_path):
        print(json.dumps({'success': False, 'error': f'File not found: {file_path}'}))
        sys.exit(1)

    try:
        from paddleocr import PaddleOCR
    except ImportError:
        print(json.dumps({
            'success': False,
            'error': 'PaddleOCR not installed. Please download the vision model in Settings.'
        }))
        sys.exit(1)

    ext = os.path.splitext(file_path)[1].lower()
    img_paths = []
    temp_dir = None

    try:
        if ext == '.pdf':
            try:
                from pdf2image import convert_from_path
                temp_dir = tempfile.mkdtemp(prefix='ocr_pdf_')
                images = convert_from_path(file_path, dpi=200, first_page=1, last_page=2)
                for i, img in enumerate(images):
                    p = os.path.join(temp_dir, f'page_{i}.png')
                    img.save(p, 'PNG')
                    img_paths.append(p)
            except ImportError:
                print(json.dumps({
                    'success': False,
                    'error': 'pdf2image not installed. Run: pip install pdf2image'
                }))
                sys.exit(1)
        else:
            img_paths = [file_path]

        if not img_paths:
            print(json.dumps({'success': False, 'error': 'No images to process'}))
            sys.exit(1)

        ocr = PaddleOCR(lang='ch', use_angle_cls=True)

        all_lines = []
        all_text_parts = []

        for img_path in img_paths:
            result = ocr.ocr(img_path)
            if result and result[0]:
                for line_info in result[0]:
                    bbox = line_info[0]
                    text = line_info[1][0]
                    confidence = float(line_info[1][1])
                    all_lines.append({
                        'text': text,
                        'confidence': round(confidence, 4),
                        'bbox': [[round(float(c), 1) for c in pt] for pt in bbox]
                    })
                    all_text_parts.append(text)

        if not all_lines:
            print(json.dumps({'success': False, 'error': 'No text detected in image'}))
            sys.exit(1)

        full_text = '\n'.join(all_text_parts)

        # Layout analysis: separate left/right columns
        if all_lines:
            xs = [l['bbox'][0][0] for l in all_lines]
            mid_x = sum(xs) / len(xs)
            left_parts = []
            right_parts = []
            for l in all_lines:
                if l['bbox'][0][0] < mid_x:
                    left_parts.append(l['text'])
                else:
                    right_parts.append(l['text'])
            left_text = '\n'.join(left_parts)
            right_text = '\n'.join(right_parts)
        else:
            left_text = ''
            right_text = ''

        output = {
            'success': True,
            'full_text': full_text,
            'left_text': left_text,
            'right_text': right_text,
            'lines': all_lines,
            'line_count': len(all_lines),
            'page_count': len(img_paths)
        }

        print(json.dumps(output, ensure_ascii=False))

    except Exception as e:
        print(json.dumps({'success': False, 'error': str(e)}))
        sys.exit(1)
    finally:
        if temp_dir and os.path.exists(temp_dir):
            import shutil
            shutil.rmtree(temp_dir, ignore_errors=True)


if __name__ == '__main__':
    main()