#!/usr/bin/env python3
"""Quick check: verify which of the 5 intersecting BioSamples have an Antibiogram table."""
import sys
import xml.etree.ElementTree as ET
import requests

CANDIDATES = ['SAMN27524633', 'SAMN27524749', 'SAMN27524759', 'SAMN27524796', 'SAMN27524868']
ENTREZ_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"

for acc in CANDIDATES:
    url = f"{ENTREZ_BASE}/efetch.fcgi?db=biosample&id={acc}&retmode=xml"
    print(f"Checking {acc}...", end="  ", flush=True)
    try:
        r = requests.get(url, timeout=30)
        r.raise_for_status()
        root = ET.fromstring(r.content)
        
        # Count antibiogram rows
        antibiogram_rows = 0
        for table in root.findall('.//Table'):
            cls = table.attrib.get('class', '')
            if 'Antibiogram' in cls:
                for tr in table.findall('.//TR'):
                    cells = [td.text for td in tr.findall('TD') if td.text]
                    if cells:
                        antibiogram_rows += 1
                break
        
        # Get organism
        organism = ""
        for attr in root.findall('.//Attribute'):
            if attr.attrib.get('harmonized_name', '') == 'organism':
                organism = attr.text or ''
                break
        
        print(f"antibiogram_rows={antibiogram_rows}  organism={organism}")
        if antibiogram_rows > 0:
            print(f"  >>> FOUND! {acc} has {antibiogram_rows} antibiogram rows!")
    except Exception as e:
        print(f"ERROR: {e}")

print("\nDone.")
