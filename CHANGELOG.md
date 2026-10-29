# Histórico de versões

## 1.1.0 — 2026-08-31

- cancelamento de pedidos ainda não analisados, com motivo, notificação e auditoria;
- edição de produtos preservando IDs e histórico, com estoque integrado à mesma tela;
- edição do nome de tipos e unidades sem alterar seus UUIDs;
- exportação CSV de estoque, movimentações, pedidos e registros;
- respostas de validação padronizadas com erros por campo;
- paginação de produtos, pedidos e registros;
- redução do volume inicial carregado nas telas;
- índices adicionais para consultas paginadas;
- consolidação das correções da versão inicial.

# 2.0.0

- Carrinho com vários produtos e revisão antes do envio.
- Pedidos agrupados com um motivo geral e um único número.
- Aprovação total, parcial ou recusa individual por item.
- Reserva e entrega transacionais de todos os itens aprovados.
- Cancelamento, notificação, e-mail e auditoria unificados por pedido.
- Pedidos V2 habilitados para todas as unidades.

# 2.5.0

- Solicitação de compra para itens ainda inexistentes no estoque.
- Prioridade, valor estimado, link e anexos protegidos.
- Fluxo de aprovação, compra e recebimento.
- Conversão do recebimento em produto com entrada na Matriz.
- Processamento de e-mail disparado imediatamente, com retomada automática da fila.

# 3.0.0

- Painel analítico com filtros de período, unidade, tipo e produto.
- Indicadores de pedidos pendentes, entregues, recusados e tempos médios.
- Evolução mensal dos pedidos e rankings de produtos e unidades.
- Destaque dos pedidos pendentes há mais tempo.
- Resumo das movimentações e identificação de itens sem uso há 90 dias.
- Escopo automático por unidade para usuários comuns e visão consolidada para master.

# 4.0.0

- Escolha entre item avulso e kit dentro de `Adicionar item`.
- Montador de kits com duas linhas iniciais e inclusão de novos componentes.
- Seleção de produtos existentes ou cadastro de componentes durante a montagem.
- Disponibilidade virtual calculada pelos saldos individuais, sem estoque duplicado.
- Kits exibidos como cards no catálogo de solicitações.
- Pedido identificado como kit, mantendo cada componente em uma linha separada.
- Entrega vinculada automaticamente ao histórico dos componentes.
- CSV de pedidos identifica kits e quantidade de kits.
- Cards de kit mostram qual componente limita a disponibilidade.
- Dashboard inclui o ranking de kits mais solicitados.
- Nova tela de devolução por unidade, com vários itens e revisão antes do envio.
- Recebimento de devoluções pelo master transfere os saldos para a Matriz.
- Cancelamento de devoluções pendentes com motivo, notificação e auditoria.
- Notificações, e-mails e exportação CSV próprios para devoluções.
