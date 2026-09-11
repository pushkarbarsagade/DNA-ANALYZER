import requests
import io

url = "https://ftp.ncbi.nlm.nih.gov/pathogen/Results/Escherichia_coli_Shigella/PDG000000004.6296/AMR/PDG000000004.6296.amr.metadata.tsv"
print("Streaming with 1MB chunks...")
r = requests.get(url, stream=True)
bio_target = "SAMN13050471"

buffer = ""
matched_lines = []
for chunk in r.iter_content(chunk_size=1024*1024, decode_unicode=True):
    if not chunk:
        continue
    buffer += chunk
    lines = buffer.split('\n')
    # keep the last incomplete line in buffer
    buffer = lines.pop()
    for line in lines:
        if bio_target in line:
            matched_lines.append(line)
            print("FOUND MATCH:", line[:150])
            r.close()
            break
    if matched_lines:
        break

print(f"Done! Found {len(matched_lines)} rows.")
