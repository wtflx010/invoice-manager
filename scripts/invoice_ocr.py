#!/usr/bin/env python3
"""
Invoice OCR using PaddleOCR 3.0 - Extract structured text from invoice PDFs/images
Usage: python3 invoice_ocr.py <image_path>
Output: JSON with extracted text lines and key-value pairs
"""

import sys
import json
import os
import tempfile
import subprocess

# Disable model source check to speed up startup
os.environ['PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK'] = 'True'

def convert_pdf_to_png(pdf_path: str) -> str:
    """Convert PDF to PNG using macOS sips command."""
    tmp_dir = tempfile.gettempdir()
    png_path = os.path.join(tmp_dir, f'invoice_ocr_{os.getpid()}.png')
    try:
        subprocess.run(
            ['sips', '-s', 'format', 'png', '--resampleHeightWidthMax', '2000',
             pdf_path, '--out', png_path],
            check=True, timeout=20, capture_output=True
        )
        if not os.path.exists(png_path):
            raise Exception('sips conversion failed')
        return png_path
    finally:
        pass
    return png_path

def extract_text_with_paddle(image_path: str) -> dict:
    """Extract text from image using PaddleOCR 3.0."""
    from paddleocr import PaddleOCR
    
    ocr = PaddleOCR(
        lang='ch',
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
        use_textline_orientation=False
    )
    
    result = ocr.predict(image_path)
    
    lines = []
    full_text = []
    
    if result:
        for res in result:
            rec_texts = getattr(res, 'rec_texts', None)
            if rec_texts is None and isinstance(res, dict):
                rec_texts = res.get('rec_texts', [])
            
            rec_scores = getattr(res, 'rec_scores', None)
            if rec_scores is None and isinstance(res, dict):
                rec_scores = res.get('rec_scores', [])
            
            dt_polys = getattr(res, 'dt_polys', None)
            if dt_polys is None and isinstance(res, dict):
                dt_polys = res.get('dt_polys', [])
            
            if not rec_texts:
                continue
                
            for i, text in enumerate(rec_texts):
                if text and text.strip():
                    score = rec_scores[i] if i < len(rec_scores) else 0
                    poly = dt_polys[i] if i < len(dt_polys) else []
                    lines.append({
                        'text': text,
                        'confidence': float(score) if score else 0,
                        'bbox': poly
                    })
                    full_text.append(text)
    
    return {
        'lines': lines,
        'full_text': '\n'.join(full_text),
        'line_count': len(lines)
    }

def main():
    if len(sys.argv) < 2:
        print(json.dumps({'success': False, 'error': 'Missing image path argument'}))
        sys.exit(1)
    
    input_path = sys.argv[1]
    is_pdf = input_path.lower().endswith('.pdf')
    
    temp_png = None
    try:
        if is_pdf:
            temp_png = convert_pdf_to_png(input_path)
            image_path = temp_png
        else:
            image_path = input_path
        
        result = extract_text_with_paddle(image_path)
        result['success'] = True
        result['input_path'] = input_path
        print(json.dumps(result, ensure_ascii=False))
        
    except Exception as e:
        print(json.dumps({
            'success': False,
            'error': str(e),
            'input_path': input_path
        }, ensure_ascii=False))
        sys.exit(1)
    finally:
        if temp_png and os.path.exists(temp_png):
            os.remove(temp_png)

if __name__ == '__main__':
    main()
