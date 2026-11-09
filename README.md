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

# banco do mês, banco único com todas as referências, índice e histórico
S=tmp REF=AAAA-MM REF_DESCRICAO="mês/AAAA-1" python3 extratores/build_db.py
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
- Composições SINAPI com mão de obra mensalista usam outro encargo (cerca de 69,7% em maio e 69,9% em
  agosto, calculado pelas composições; a confirmar no relatório "Modelo de Encargos Sociais Mensalistas").
- Modelo DNIT: (equipamentos + mão de obra) ÷ produção da equipe + serviços auxiliares por unidade.
- Códigos de insumo e de composição se repetem na mesma base; só itens da seção "serviço auxiliar"
  apontam para outra composição.

## Histórico e atualização de referência

- Cada item guarda o preço em todas as referências (tabela `historico`). A busca mostra a variação
  em relação à referência anterior, e cada composição e insumo mostra seu histórico.
- Página **O que mudou**: resumo e maiores altas e quedas entre as duas últimas referências.
- Item que saiu da base continua abrindo, com os valores da última referência em que aparece.
- Orçamento com preços de uma referência antiga é sinalizado. **Ver o impacto** mostra o total antes e
  depois; **Atualizar** leva os custos para a referência atual (ou **Duplicar e atualizar a cópia**).
  Itens que saíram da base ficam com o preço antigo e são listados para substituição.
- A curva ABC de insumos desmonta cada item com a composição da data-base do próprio item.

Maio → agosto/2026: 74,8% dos serviços subiram (mediana ORSE +2,8%, SINAPI +7,5%); 196 serviços novos e
175 saíram da base (ex.: 103335/SINAPI). Encargo de horista mantido em 111,51%.

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
- Confirmar o encargo de mensalistas e o significado do marcador "#" nos preços de insumos.
- Composições próprias, relatórios no formato de edital, cronograma físico-financeiro.
