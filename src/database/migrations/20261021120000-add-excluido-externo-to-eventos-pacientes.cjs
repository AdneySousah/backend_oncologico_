'use strict';

// Evento de compra excluído no sistema externo: ele simplesmente deixa de
// vir na lista de eventos do paciente, mas a linha local continuava com
// recebido = true e processado = false — e era oferecida no telemonitoramento
// para sempre. O sync passa a marcar esses eventos (excluido_externo) e as
// consultas de compra pendente passam a ignorá-los. Nada é apagado: o
// histórico e a auditoria continuam enxergando a linha.
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('eventos_pacientes', 'excluido_externo', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: 'true quando o evento deixou de existir no sistema externo (excluído lá)'
    });
    await queryInterface.addColumn('eventos_pacientes', 'excluido_em', {
      type: Sequelize.DATE,
      allowNull: true,
      comment: 'Momento em que o sync detectou a exclusão'
    });
  },

  down: async (queryInterface) => {
    await queryInterface.removeColumn('eventos_pacientes', 'excluido_em');
    await queryInterface.removeColumn('eventos_pacientes', 'excluido_externo');
  }
};
