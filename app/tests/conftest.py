import os
import tempfile

# Orçamentos dos testes num banco temporário, nunca no banco de trabalho.
os.environ['ORCAMENTOS_DB'] = os.path.join(tempfile.mkdtemp(), 'teste.sqlite')
