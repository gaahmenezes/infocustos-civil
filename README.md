# InfoCustos Civil — consulta ORSE e SINAPI (protótipo)

Consulta da base de preços de obras de Sergipe (ORSE/CEHOP) e da SINAPI usada pela CEHOP:
busca rápida, composição analítica em árvore, orçamento com BDI e curva ABC, e histórico de preços entre referências.

Referências carregadas: **maio/2026** e **agosto/2026**.

## Rodar

```bash
pip install -r requirements.txt
gunzip -k dados/orse_sinapi_*.sqlite.gz                   # um banco por referência
python3 extratores/juntar_referencias.py dados/orse_sinapi.sqlite dados/orse_sinapi_20*.sqlite
python3 app/build_index.py dados/orse_sinapi.sqlite          # busca + histórico de preços
cd app
uvicorn server:app --port 8000
```

Abra http://localhost:8000. Atalho: `/` foca a busca; setas navegam nos resultados.

## Estrutura

| Pasta | Conteúdo |
|---|---|
| `dados/` | Um banco `orse_sinapi_AAAA-MM.sqlite.gz` por referência (fonte de verdade) e `planilhas/` em Excel |
| `extratores/` | Leitura dos PDFs gerados pelo programa ORSE |
| `app/` | Servidor (FastAPI + SQLite FTS5), interface (`static/`) e testes |
| `artefato/` | Versão estática para teste no claude.ai (dados e orçamentos no navegador) |
| `docs/` | Telas e um orçamento de exemplo exportado |

## Atualização mensal

No programa ORSE, em *Relatórios → Relatórios Cadastrais*, gere em PDF:

1. Tabela de Preço de Insumos (ORSE e SINAPI)
2. Tabela de Preço de Serviços (ORSE e SINAPI)
3. Relatório de Composições (ORSE e SINAPI)
4. Modelo de Encargo Social Horista e Modelo de Encargo Social Mensalista

Depois:

```bash
# tabelas de preço (insumos e serviços, ORSE e SINAPI)
python3 extratores/parse_insumos.py <insumos_orse.pdf> tmp/orse_insumos_raw.json
python3 extratores/build_insumos.py tmp/orse_insumos_raw.json dados/orse_insumos_AAAA-MM
python3 extratores/parse_insumos.py <servicos_orse.pdf> tmp/orse_servicos_raw.json
python3 extratores/build_servicos.py tmp/orse_servicos_raw.json dados/orse_servicos_AAAA-MM
#   (idem para sinapi_insumos_AAAA-MM e sinapi_servicos_AAAA-MM)

# composições analíticas
pdftotext -layout <composicoes_orse.pdf> tmp/comp.txt
python3 extratores/parse_composicoes.py tmp/comp.txt tmp/comp_raw.json ORSE
pdftotext -layout <composicoes_sinapi.pdf> tmp/comp_sinapi.txt
python3 extratores/parse_composicoes.py tmp/comp_sinapi.txt tmp/comp_sinapi_raw.json SINAPI

# banco do mês, encargos, banco único com todas as referências e índice
S=tmp REF=AAAA-MM REF_DESCRICAO="mês/AAAA-1" python3 extratores/build_db.py
python3 extratores/parse_encargos.py dados/orse_sinapi_AAAA-MM.sqlite <encargos_horista.pdf> <encargos_mensalista.pdf>
gzip -9 -k dados/orse_sinapi_AAAA-MM.sqlite                   # este .gz vai para o repositório
python3 extratores/juntar_referencias.py dados/orse_sinapi.sqlite dados/orse_sinapi_20*.sqlite
python3 app/build_index.py dados/orse_sinapi.sqlite

# artefato de teste
python3 artefato/build_dados.py dados/orse_sinapi.sqlite artefato/saida
python3 artefato/build_artefato.py artefato/saida
```

Os extratores conferem os totais do próprio relatório (quantidade por grupo e "TOTAL GERAL").

## Regras de cálculo observadas na base

- Mão de obra horista entra na composição com encargo social de 111,51% sobre o salário da tabela.
- Composições SINAPI com mão de obra mensalista usam o encargo de mensalista (69,72% em agosto/2026,
  conforme o relatório da CEHOP), enquanto o relatório analítico mostra o custo com o encargo de horista.
- Modelo DNIT: (equipamentos + mão de obra) ÷ produção da equipe + serviços auxiliares por unidade.
- Códigos de insumo e de composição se repetem na mesma base; só itens da seção "serviço auxiliar"
  apontam para outra composição.

## Meses de referência

- **Cada mês é uma aba própria.** Ao escolher o mês no topo, a consulta, as composições, os insumos e os
  encargos sociais mostram só os valores daquele mês, sem misturar com outros.
- **Comparativo entre meses** é a única aba que mostra meses juntos: escolha os dois meses, filtre por
  serviços ou insumos, base e texto, e veja as maiores altas e quedas. Clicando no código, aparece o preço
  do item em todos os meses carregados.
- **Encargos sociais:** quadro de horistas e mensalistas do mês, como no relatório da CEHOP
  (`extratores/parse_encargos.py` lê os PDFs "Modelo de Encargo Social Horista/Mensalista").
  Agosto/2026: horista 111,51%, mensalista 69,72%. Maio/2026: só o total de horista (111,51%).
- **Orçamento:** cada orçamento tem uma data-base (um mês). Os itens entram sempre com o preço desse mês.
  Trocar a data-base mostra o novo total e os itens que não existem no mês escolhido, e pede confirmação;
  dá também para criar uma cópia no outro mês e manter o original.
- Item que não existe no mês escolhido avisa e oferece abrir no mês em que existe (ex.: 103335/SINAPI só em maio).

## Orçamento (fase 2)

- Etapas e itens numerados (1, 1.1…), com serviços ou insumos ORSE e SINAPI.
- Custo unitário congelado na data-base em que o item entrou; preço com BDI e total arredondados em 2 casas
  (meio para cima, igual ao ARRED do Excel).
- Curva ABC de serviços (valor com BDI) e de insumos (composições desmontadas até o insumo, incluindo
  serviços auxiliares e o modelo DNIT). Classe A até 80% acumulado, B até 95%, C o restante.
- Exportação Excel com 3 abas; preço e total por item são fórmulas, e o BDI fica na célula H2.
- Os orçamentos ficam em `app/orcamentos.sqlite` (ou na variável `ORCAMENTOS_DB`).

## Testes

```bash
cd app && python3 -m pytest tests -q        # API: consulta e orçamento
node tests/e2e.js && node tests/e2e_orc.js  # navegador, com o servidor na porta 8000 (Playwright)
```

## Versão de teste (artefato)

https://claude.ai/artifact/4RYzkGmFRxnGs3XV9EBjMM — mesma interface, rodando só no navegador.
"Copiar para o Excel" no lugar da exportação, e orçamentos salvos apenas no navegador de quem testa.

## Próximos passos

- Histórico mensal de preços quando houver mais de uma referência carregada.
- Banco PostgreSQL e autenticação para uso em equipe (publicação no Render).
- Encargos detalhados de maio/2026, se for preciso. Significado do marcador "#" nos preços de insumos.
- Composições próprias, relatórios no formato de edital, cronograma físico-financeiro.
