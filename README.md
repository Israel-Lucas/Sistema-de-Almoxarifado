# Almoxarifado — sua empresa

Versão atual: **4.0.0**. Consulte [CHANGELOG.md](CHANGELOG.md) para as alterações.

Sistema interno para cadastro de itens, controle do estoque central da Matriz,
solicitações das unidades, acompanhamento de pedidos, notificações, e-mails e
auditoria das operações.

## Dados da aplicação

O repositório contém o código e as migrações do sistema. Cadastre os dados
operacionais no banco da sua empresa, sem incluir dados reais neste repositório.

## Privacidade e LGPD

O código não inclui uma base operacional. Em uso, o sistema pode processar
nomes, usuários, e-mails, dados de pedidos e anexos enviados pelos usuários. Os
registros de auditoria também armazenam o IP e os detalhes das operações.

Antes de usar com dados reais, a empresa responsável deve definir finalidade e
base legal, informar os titulares, limitar acesso e retenção, proteger backups
e atender solicitações de titulares. Não publique arquivos `.env`, dumps,
logs, anexos ou dados reais neste repositório.

## Tecnologias

- frontend em HTML, CSS e JavaScript;
- backend Node.js com Express;
- PostgreSQL;
- autenticação por sessão armazenada no PostgreSQL;
- envio de e-mail por SMTP.

Recomenda-se Node.js 20 ou superior e uma versão do PostgreSQL ainda suportada.

## Estrutura do projeto

```text
assets/                         Imagens e recursos visuais
html/                           Páginas da aplicação
scripts/                        JavaScript executado no navegador
styles/                         Estilos globais e de cada página
server/app.js                   Inicialização do servidor
server/config.js                Leitura e validação das configurações
server/routes/                  Rotas e regras da API
server/middleware/              Autenticação, validação, erros e auditoria
server/services/                Processamento da fila de e-mails
server/database/                Conexão, migrações e seed inicial
server/database/migrations/     Histórico versionado do banco
.env.example                    Modelo das configurações
```

`node_modules` não deve ser copiado para o servidor. Ele é recriado com
`npm ci`.

## Configuração do ambiente

Copie `.env.example` para `.env` e preencha os valores:

```env
NODE_ENV=development
HOST=0.0.0.0
PORT=3000
DATABASE_URL=postgresql://usuario:senha@localhost:5432/nome_do_banco
SESSION_SECRET=
SESSION_HOURS=8
EMAIL_FROM=
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASSWORD=
ADMIN_USERNAME=
ADMIN_NAME=
ADMIN_PASSWORD=
```

### Regras das variáveis

- `HOST=0.0.0.0`: permite acesso por outros computadores da rede.
- `PORT=3000`: porta utilizada pelo sistema.
- `DATABASE_URL`: conexão completa com o PostgreSQL.
- `SESSION_SECRET`: chave aleatória privada com no mínimo 32 caracteres.
- `SESSION_HOURS`: duração da sessão em horas.
- `EMAIL_FROM`: remetente apresentado nas mensagens; se vazio, usa `SMTP_USER`.
- `SMTP_SECURE=false`: configuração comum para porta 587 com STARTTLS.
- `SMTP_SECURE=true`: normalmente utilizado com SMTP na porta 465.
- `ADMIN_USERNAME`, `ADMIN_NAME` e `ADMIN_PASSWORD`: credenciais usadas somente
  pelo seed para criar o primeiro usuário master. Defina uma senha exclusiva
  com pelo menos 12 caracteres antes de executar `npm run db:seed`.

Se usuário ou senha do banco contiverem caracteres reservados de URL, eles
precisam ser codificados na `DATABASE_URL`.

Nunca publique, envie por mensagem ou armazene o `.env` em repositório. O
arquivo já está ignorado pelo `.gitignore`.

## Acesso temporário por IP e HTTP

O acesso planejado é:

```text
http://IP_DO_SERVIDOR:3000
```

Enquanto o sistema estiver sendo acessado por HTTP direto no IP, mantenha:

```env
NODE_ENV=development
```

Na implementação atual, `NODE_ENV=production` marca o cookie de sessão como
seguro. Navegadores não enviam esse cookie por HTTP e o login pode não
permanecer autenticado. Quando houver HTTPS, altere para `NODE_ENV=production`.

Para permitir o funcionamento temporário por HTTP, o servidor também mantém
HSTS desativado e não envia a diretiva CSP `upgrade-insecure-requests`. Quando
for implantado HTTPS, essas duas proteções devem ser reativadas em
`server/app.js`.

Também é necessário liberar a porta 3000 no firewall apenas para a rede ou os
endereços que devem acessar o sistema. A regra exata de firewall depende do
sistema operacional e da infraestrutura do servidor.

## Instalação no servidor

Na pasta do projeto:

```bash
npm ci
npm run db:migrate
npm start
```

Depois, acesse `http://IP_DO_SERVIDOR:3000`.

### Banco completamente novo

Para um banco vazio:

```bash
npm run db:migrate
npm run db:seed
```

Antes de executar o seed, defina no `.env` o usuário, o nome e uma senha forte
do administrador (`ADMIN_USERNAME`, `ADMIN_NAME` e `ADMIN_PASSWORD`). O seed cria:

- unidade `Matriz`;
- usuário master com as credenciais configuradas no ambiente.

Executar o seed novamente não altera a senha de uma conta já existente.

## Execução contínua

`npm start` mantém o sistema ativo somente enquanto o processo estiver em
execução. No servidor, configure o Node como serviço usando a ferramenta
adotada no ambiente, por exemplo PM2, NSSM, systemd ou o gerenciador já usado
pela empresa.

Essa configuração depende do sistema operacional e não foi automatizada pelo
projeto. O serviço deve:

- iniciar na pasta correta;
- carregar o `.env`;
- executar `node server/app.js`;
- reiniciar após falha ou reinicialização do servidor;
- armazenar a saída de erro em local protegido e com rotação.

## Perfis e permissões

### Master da Matriz

Pode:

- visualizar os estoques de todas as unidades;
- cadastrar e excluir produtos;
- criar, alterar e excluir tipos quando permitido;
- alterar estoque, registrar entrada, baixa ou transferência;
- analisar pedidos;
- marcar pedidos aprovados como entregues;
- receber devoluções das unidades e transferir os itens para a Matriz;
- administrar usuários e unidades;
- consultar registros de auditoria.

O master protegido e a unidade Matriz não podem ser excluídos. O último master
também não pode ser removido.

### Usuário comum

Visualiza somente:

- Dashboard da própria unidade;
- Solicitação;
- Devolução;
- Pedidos da própria unidade.

O usuário comum não administra estoque, produtos, unidades, usuários ou
registros.

## Produtos e estoque

- Nome, modelo e tipo identificam um produto único existente.
- Comparações ignoram diferenças entre maiúsculas e minúsculas.
- A apresentação preserva a forma digitada pelo usuário.
- Campos comuns aceitam até 100 caracteres.
- Descrição, motivo e notas aceitam até 500 caracteres.
- Quantidades são inteiras entre 0 e 999.
- Decimais e estoque negativo são rejeitados.
- Somente a Matriz recebe alertas de estoque baixo.
- Outras unidades mostram quantidade, mas não são classificadas como estoque
  baixo ou sem estoque.

Um produto só pode ser excluído quando o saldo total em todas as unidades for
zero. A exclusão é lógica para preservar pedidos antigos. Um produto excluído
pode ser cadastrado novamente com o mesmo nome, modelo e tipo.

### Devoluções

Na tela `Devolução`, o usuário seleciona itens que possuem saldo em sua unidade,
informa as quantidades e um motivo e envia tudo em uma única devolução. Enquanto
ela aguarda recebimento, o saldo permanece na unidade e o usuário pode cancelar
o envio informando o motivo.

A devolução aparece em uma aba própria da tela `Pedidos`. Somente o master pode
marcá-la como recebida. Nesse momento, o sistema valida novamente os saldos,
retira as quantidades da unidade e acrescenta na Matriz em uma única transação.
Uma devolução recebida ou cancelada não pode ser processada novamente.

Criação, cancelamento e recebimento geram auditoria e notificações. A criação é
enviada por e-mail ao almoxarifado; conclusão e cancelamento são enviados aos
usuários da unidade que possuam e-mail cadastrado. A listagem também pode ser
exportada em CSV.

### Paginação

A paginação limita quantos registros são carregados de uma vez, evitando telas
lentas quando o histórico ou catálogo crescer. No catálogo, os kits aparecem uma
única vez na primeira página e o contador distingue itens avulsos de kits.

### Exportação CSV

O CSV de pedidos identifica itens avulsos e kits. A exportação de devoluções
informa número, unidade, usuário, itens, quantidades, motivo e situação. Os
arquivos podem ser abertos diretamente pelo Excel e respeitam os filtros ativos.

### Alteração manual do estoque

A tela `Alterar estoque` permite:

- entrada: preencher somente `Acrescentar em`;
- baixa: preencher somente `Remover de`;
- transferência: preencher origem e destino.

Não é possível remover mais que o saldo disponível. Em uma transferência, a
quantidade acrescentada deve ser menor ou igual à quantidade removida. A
operação ocorre em uma transação: se uma etapa falhar, nenhuma alteração é
confirmada.

## Fluxo dos pedidos

1. A unidade seleciona um produto disponível na Matriz.
2. Informa quantidade inteira e motivo.
3. O pedido recebe o status `Solicitado`.
4. Um master pode aprovar, aprovar parcialmente ou recusar.
5. Aprovação integral reserva toda a quantidade aprovada na Matriz.
6. Aprovação parcial exige quantidade menor e nota explicativa.
7. Recusa exige nota e não altera o estoque.
8. Pedido aprovado fica como `Preparando`.
9. Um master marca o pedido como `Entregue`.
10. A entrega acrescenta o saldo na unidade solicitante uma única vez.

Pedidos aprovados não podem ser cancelados. Uma segunda entrega é bloqueada.
A quantidade solicitada não pode superar a disponibilidade atual da Matriz.

## Dashboard

O dashboard comum mostra somente os itens e as quantidades da própria unidade.

O dashboard master mostra todas as unidades, mas os indicadores `Disponível`,
`Estoque baixo` e `Sem estoque` são aplicados somente às linhas da Matriz. O
filtro universal permite combinar unidade, situação, tipo, modelo e item.

### Indicadores da V3.0

O painel analítico usa os dados já existentes, sem tabelas auxiliares. É possível
filtrar por período, unidade, tipo e produto. Usuários comuns permanecem
limitados à própria unidade mesmo que tentem alterar os parâmetros da API.

São exibidos:

- total de pedidos, pendentes, entregues e recusados;
- tempo médio entre criação e análise e entre aprovação e entrega;
- evolução mensal de pedidos e entregas;
- itens mais solicitados;
- unidades com maior consumo, considerando somente itens entregues;
- pedidos pendentes ordenados do mais antigo para o mais recente;
- movimentações agrupadas por tipo;
- produtos sem solicitação ou movimentação nos últimos 90 dias.

Os rankings entre unidades, as movimentações gerais e os itens sem uso recente
são exclusivos do master. A rota utilizada é `GET /api/analytics/dashboard`.

## Kits de itens — V4.0

Não existe estoque separado para kits. Um kit é uma composição virtual de dois
ou mais produtos avulsos e usa diretamente o saldo desses produtos.

Ao clicar em `Adicionar item`, o master escolhe:

- `Item avulso`: abre o cadastro tradicional;
- `Kit de itens`: abre o montador com duas linhas iniciais e permite acrescentar
  outras pelo botão `+ Adicionar item`.

Cada linha do kit pode selecionar um produto já cadastrado ou criar um novo,
informando nome, marca/modelo, tipo, descrição, estoque inicial e quantidade
usada em cada kit. O kit também possui nome, tipo e descrição próprios.

A disponibilidade é calculada pelo componente limitante. Se o kit usa um
notebook, um suporte e um mouse e os saldos são respectivamente 5, 7 e 2, o
catálogo mostra 2 kits disponíveis. Os mesmos itens continuam disponíveis para
solicitações avulsas.

Ao solicitar kits, o pedido mantém o nome e a quantidade de kits, mas cada
componente é registrado em uma linha separada. Aprovação, reserva e entrega
continuam movimentando os produtos individuais, impedindo saldo duplicado.

As estruturas internas de composição são mantidas pelas migrações `015` a
`018`, mas não existe uma guia separada de conjuntos na interface.

## Notificações

- Novos pedidos notificam os masters ativos da Matriz.
- Decisões e entregas notificam a unidade solicitante e os masters da Matriz.
- O painel consulta novas notificações periodicamente.
- Manter o painel aberto por um segundo marca as mensagens como lidas.
- Fechar antes desse tempo preserva o estado não lido.

## E-mails

Uma nova solicitação gera:

```text
Assunto: Solicitação de itens para NOME_DA_UNIDADE
Corpo: Usuário NOME solicitou QUANTIDADE ITEM para a unidade de NOME_DA_UNIDADE
```

Quando o estoque da Matriz cruza o limite de mais de 5 para 5 ou menos:

```text
Assunto: Estoque baixo
Corpo: O item ITEM está com o estoque QUANTIDADE, solicitar compra ou devolução
```

Saldos baixos de outras unidades não geram esse aviso. O alerta não é repetido
enquanto o saldo permanecer abaixo do limite; após reabastecer acima de 5, uma
nova queda pode gerar outro e-mail.

Os e-mails são gravados em `email_outbox` e processados em segundo plano. Uma
falha não interrompe o pedido. O sistema tenta novamente, até o limite
configurado no código, e preserva o erro para diagnóstico.
Os avisos são enviados aos usuários master ativos da Matriz que tenham e-mail
cadastrado; configure também o acesso SMTP no `.env`.

## Auditoria

Operações de alteração bem-sucedidas são gravadas automaticamente. A tela
Registros apresenta responsável, unidade, tipo e descrição legível da
atividade. Senhas não são armazenadas nos detalhes da auditoria.

As movimentações de estoque mantêm quantidade anterior, quantidade alterada e
quantidade posterior. Não altere saldos diretamente no PostgreSQL, pois isso
ignora validações e o histórico.

## Segurança implementada

- senhas armazenadas com hash bcrypt;
- sessão regenerada após login;
- cookie de sessão `HttpOnly` e `SameSite=Strict`;
- sessões persistidas no PostgreSQL;
- limite de 20 tentativas de login por IP em 15 minutos;
- bloqueio da conta por 15 minutos após 5 senhas incorretas;
- validação de origem em requisições de alteração;
- validação de dados no servidor;
- confirmação explícita em operações destrutivas;
- autorização verificada na API, não apenas na interface;
- cabeçalhos de segurança com Helmet;
- mensagens genéricas para erros internos.

## Mapeamento de erros

| Código                   | Significado / ação recomendada                                   |
| ------------------------ | ---------------------------------------------------------------- |
| `AUTH_REQUIRED`          | Sessão ausente ou expirada; entre novamente.                     |
| `FORBIDDEN`              | O perfil não possui permissão para a operação.                   |
| `INVALID_CREDENTIALS`    | Usuário, senha, conta ou unidade inválidos/inativos.             |
| `ACCOUNT_LOCKED`         | Aguarde 15 minutos antes de tentar novamente.                    |
| `INVALID_PASSWORD`       | A senha atual informada está incorreta.                          |
| `VALIDATION_ERROR`       | Dados ausentes, fora dos limites ou em formato inválido.         |
| `DUPLICATE`              | Já existe um registro atual com a mesma identificação.           |
| `NOT_FOUND`              | Registro ou endereço não encontrado.                             |
| `IN_USE`                 | O registro ainda possui vínculos ou estoque.                     |
| `PROTECTED`              | Tentativa de alterar/excluir unidade protegida.                  |
| `CURRENT_USER_PROTECTED` | O usuário conectado não pode desativar/excluir a própria conta.  |
| `LAST_MASTER`            | O último master não pode ser excluído.                           |
| `INVALID_UNIT`           | Unidade inexistente ou inativa.                                  |
| `EMAIL_REQUIRED`         | Master da Matriz precisa possuir e-mail.                         |
| `INVALID_TYPE`           | Tipo de produto inexistente ou inativo.                          |
| `UNAVAILABLE`            | Produto sem disponibilidade na Matriz.                           |
| `INSUFFICIENT_AVAILABLE` | Solicitação maior que o saldo disponível.                        |
| `ALREADY_DECIDED`        | O pedido já foi analisado.                                       |
| `NOTE_REQUIRED`          | A recusa exige justificativa.                                    |
| `QUANTITY_REQUIRED`      | A aprovação exige quantidade.                                    |
| `INVALID_QUANTITY`       | Aprovação integral diferente do total solicitado.                |
| `PARTIAL_NOTE_REQUIRED`  | Aprovação parcial exige quantidade menor e nota.                 |
| `INSUFFICIENT_STOCK`     | Saldo insuficiente para aprovação, baixa ou transferência.       |
| `NOT_PREPARING`          | Pedido não está apto para entrega ou já foi entregue.            |
| `MAX_QUANTITY`           | A operação ultrapassaria 999 unidades.                           |
| `INTERNAL_ERROR`         | Verifique os registros do processo Node e a conexão com o banco. |

O navegador apresenta mensagens amigáveis. Os códigos acima existem para
diagnóstico da API.

## Diagnóstico de problemas

### Página não abre

- confirme que o processo Node está ativo;
- confirme `HOST=0.0.0.0` e `PORT=3000`;
- teste `http://localhost:3000` no próprio servidor;
- verifique firewall e conectividade da rede.

### Login volta para a tela inicial

- confirme que o banco está disponível;
- confirme que `SESSION_SECRET` possui pelo menos 32 caracteres;
- usando HTTP por IP, mantenha `NODE_ENV=development`;
- apague cookies antigos do endereço após mudar configurações de sessão.

### Banco não conecta

- revise host, porta, usuário, senha e banco na `DATABASE_URL`;
- confirme acesso do servidor Node ao PostgreSQL;
- confirme regras de rede e autenticação do PostgreSQL;
- execute `npm run db:migrate` e observe a mensagem apresentada.

### E-mail não chega

- revise `SMTP_HOST`, porta, usuário e senha;
- confirme a combinação de porta e `SMTP_SECURE`;
- verifique spam e regras da caixa de saída;
- consulte `email_outbox` e a saída de erro do processo Node;
- confirme que o servidor possui saída liberada para o SMTP.

### Alteração não aparece no navegador

- atualize com `Ctrl + F5`;
- confirme que somente uma instância correta do Node está atendendo a porta;
- reinicie o processo depois de alterações no backend.

## Migrações e atualizações

Nunca apague arquivos de `server/database/migrations`. Eles representam a
estrutura do banco e são executados uma única vez, em ordem, por:

```bash
npm run db:migrate
```

Para atualizar o sistema:

1. faça backup do banco e da versão atual do projeto;
2. pare o processo Node;
3. substitua os arquivos da aplicação sem substituir o `.env` por engano;
4. execute `npm ci`;
5. execute `npm run db:migrate`;
6. inicie o processo;
7. valide login, dashboard, pedido e e-mail.

Não execute rotinas de limpeza em um ambiente com dados reais sem autorização
e backup verificado.

### Pedidos V2

A versão 2.0 agrupa vários produtos em um único pedido. O usuário monta o
carrinho, revisa quantidades e informa um motivo geral. O master analisa cada
item separadamente, podendo aprovar, aprovar parcialmente ou recusar. Os itens
aprovados são reservados na Matriz em uma única transação e entregues juntos.

Pedidos anteriores são preservados e convertidos pela migração `012` em
pedidos agrupados com um item. Não apague nem recrie esses registros.

A versão 2.0 fica ativa para todas as unidades. Após atualizar, valide carrinho,
envio, e-mail, análise por item, reserva, entrega, registros e saldos.

O carrinho ainda não enviado fica somente no navegador e é separado por
unidade. O servidor sempre valida novamente produtos, quantidades e estoque ao
receber o pedido.

### Solicitações de compra V2.5

Quando um item ainda não existe no catálogo, o usuário pode usar **Solicitar
item novo**. A solicitação registra quantidade, justificativa, prioridade,
valor estimado e link opcional. Podem ser anexados até três arquivos PDF,
JPG, PNG ou WEBP, com limite de 5 MB por arquivo.

O acompanhamento fica em **Pedidos > Itens novos / compras**. O fluxo é:

1. solicitado;
2. aprovado ou recusado pelo master;
3. em compra;
4. recebido e convertido em produto;
5. quantidade recebida adicionada ao estoque da Matriz.

Os anexos ficam em `storage/purchase-attachments` e não são publicados como
arquivos estáticos. O download exige sessão e permissão sobre a unidade. Essa
pasta deve ser incluída na rotina de backup juntamente com o PostgreSQL.

## Backup e restauração

Antes de atualizar ou alterar o banco, gere backup com a ferramenta adotada
pela empresa, por exemplo `pg_dump` ou a interface administrativa utilizada.
Teste periodicamente a restauração em um banco separado.

O procedimento, destino, retenção, criptografia e responsável pelos backups
dependem da infraestrutura da empresa e devem ser definidos internamente.

## Checklist após instalação

- [ ] `.env` preenchido e protegido;
- [ ] dependências instaladas com `npm ci`;
- [ ] migrações aplicadas sem erro;
- [ ] processo Node ativo na porta 3000;
- [ ] porta liberada somente para a rede necessária;
- [ ] login do master funcionando;
- [ ] senha inicial alterada, quando aplicável;
- [ ] criação de tipo e produto funcionando;
- [ ] criação de unidade e usuário comum funcionando;
- [ ] solicitação, aprovação e entrega funcionando;
- [ ] alteração manual de estoque funcionando;
- [ ] notificações funcionando;
- [ ] envio SMTP funcionando;
- [ ] serviço configurado para iniciar com o servidor;
- [ ] backup do PostgreSQL configurado.

## Itens dependentes da infraestrutura

Devem ser concluídos pelo responsável pelo servidor:

- instalação do Node.js e acesso ao PostgreSQL;
- regra de firewall para a porta 3000;
- execução permanente como serviço;
- política de backup e retenção;
- permissões da pasta e proteção do `.env`;
- monitoramento de processo, disco e banco;
- implantação futura de HTTPS, domínio ou proxy reverso.
