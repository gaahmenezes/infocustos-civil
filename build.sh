#!/usr/bin/env bash
# Publicação: instala as dependências e monta o banco único a partir dos bancos mensais compactados.
set -euo pipefail
cd "$(dirname "$0")"
pip install -r requirements.txt
# um banco por base e mês: orse_sinapi_AAAA-MM (ORSE, da CEHOP), sinapi_AAAA-MM (SINAPI, da CAIXA) e sicro_AAAA-MM (SICRO/DNIT),
# mais os meses enviados e publicados pela tela "Bases oficiais" (guardados no banco dos orçamentos)
python3 extratores/montar_base.py dados/orse_sinapi.sqlite
