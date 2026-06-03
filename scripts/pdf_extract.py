#!/usr/bin/env python3
"""
Fast PDF text extraction using pdfplumber (milliseconds for electronic invoices)
Usage: python3 pdf_extract.py <pdf_path>
Output: JSON with extracted text
"""

import sys
import json
import os

def main():
    if len(sys.argv) < 2:
        print(json.dumps({'success': False, 'error': 'Missing PDF path argument'}))
        sys.exit(1)
    
    pdf_path = sys.argv[1]
    
    if not os.path.exists(pdf_path):
        print(json.dumps({'success': False, 'error': f'File not found: {pdf_path}'}))
        sys.exit(1)
    
    try:
        import pdfplumber
    except ImportError:
        print(json.dumps({'success': False, 'error': 'pdfplumber not installed'}))
        sys.exit(1)
    
    try:
        full_text_parts = []
        tables_text = []
        
        with pdfplumber.open(pdf_path) as pdf:
            for page_num, page in enumerate(pdf.pages):
                # Extract text
                text = page.extract_text()
                if text:
                    full_text_parts.append(text)
                
                # Extract tables (for invoice tables)
                tables = page.extract_tables()
                if tables:
                    for table in tables:
                        for row in table:
                            row_text = ' | '.join(str(cell) for cell in row if cell is not None)
                            if row_text.strip():
                                tables_text.append(row_text)
        
        result = {
            'success': True,
            'full_text': '\n'.join(full_text_parts),
            'tables_text': '\n'.join(tables_text),
            'page_count': len(full_text_parts),
            'has_text': len(full_text_parts) > 0
        }
        
        print(json.dumps(result, ensure_ascii=False))
        
    except Exception as e:
        print(json.dumps({
            'success': False,
            'error': str(e)
        }, ensure_ascii=False))
        sys.exit(1)

if __name__ == '__main__':
    main()
