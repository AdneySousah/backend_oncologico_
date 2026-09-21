'use strict';

// Permite cancelar/invalidar um termo já enviado — seja porque foi enviado
// pro número errado, ou porque precisa desfazer um aceite (mesmo depois de
// já aceito). O link em si não tem token próprio (é só /paciente/termo/:id),
// então "invalidar o link" significa: a tela pública passa a mostrar "link
// não disponível" pra esse paciente, em vez do formulário normal, até que
// um novo termo seja enviado (o que já reseta o status pra "Pendente"
// normalmente, sobrescrevendo o "Cancelado").
module.exports = {
  up: async (queryInterface) => {
    await queryInterface.sequelize.query(
      `ALTER TYPE "enum_pacientes_status_termo" ADD VALUE IF NOT EXISTS 'Cancelado';`
    );
  },

  down: async (queryInterface) => {
    // Não é possível remover um valor de enum no Postgres sem recriar o
    // tipo inteiro — deixado como está no rollback.
  }
};
