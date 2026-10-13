-- Índices nas chaves estrangeiras com ON DELETE SET NULL: sem eles, excluir um contato
-- ou uma mensagem obriga o banco a varrer a tabela inteira de mensagens/pedidos.
CREATE INDEX messages_contact ON messages (contact_id);
CREATE INDEX conversions_message ON conversions (message_id);
CREATE INDEX conversions_contact ON conversions (contact_id);
