#!/usr/bin/env bash
# Publicação: instala as dependências e monta o banco único a partir dos bancos mensais compactados.
set -euo pipefail
cd "$(dirname "$0")"
pip install -r requirements.txt
for gz in dados/orse_sinapi_20*.sqlite.gz; do
  gunzip -kf "$gz"
done
python3 extratores/juntar_referencias.py dados/orse_sinapi.sqlite dados/orse_sinapi_20*.sqlite
python3 app/build_index.py dados/orse_sinapi.sqlite
rm -f dados/orse_sinapi_20*.sqlite   # os mensais já estão no banco único
