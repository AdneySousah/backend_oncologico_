'use strict';

// Pausa temporária de UM medicamento específico (diferente de "Pausar
// Tratamento", que pausa o paciente inteiro, indefinidamente). Aqui a
// pausa tem prazo previsto, e o registro sai da fila normal de
// pendências (status PAUSADO) até alguém destravar. A contagem de
// comprimidos consumidos ignora os dias dentro do período de pausa.
module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Adiciona 'PAUSADO' ao enum de status existente.
    await queryInterface.sequelize.query(
      `ALTER TYPE "enum_monitoramento_medicamentos_status" ADD VALUE IF NOT EXISTS 'PAUSADO';`
    );

    await queryInterface.addColumn('monitoramento_medicamentos', 'data_pausa_inicio', {
      type: Sequelize.DATE,
      allowNull: true,
    });
    await queryInterface.addColumn('monitoramento_medicamentos', 'data_pausa_fim_prevista', {
      type: Sequelize.DATE,
      allowNull: true,
    });
    await queryInterface.addColumn('monitoramento_medicamentos', 'motivo_pausa_medicamento_id', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: 'motivos_pausa_tratamento', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });
    await queryInterface.addColumn('monitoramento_medicamentos', 'motivo_pausa_medicamento_observacao', {
      type: Sequelize.TEXT,
      allowNull: true,
    });
    // Histórico de todos os períodos de pausa já concluídos deste ciclo
    // (permite pausar mais de uma vez no mesmo ciclo) — usado pelo cálculo
    // de comprimidos consumidos, que precisa excluir TODOS esses períodos,
    // não só o mais recente.
    await queryInterface.addColumn('monitoramento_medicamentos', 'pausas_historico', {
      type: Sequelize.JSONB,
      allowNull: true,
    });
  },

  down: async (queryInterface) => {
    await queryInterface.removeColumn('monitoramento_medicamentos', 'pausas_historico');
    await queryInterface.removeColumn('monitoramento_medicamentos', 'motivo_pausa_medicamento_observacao');
    await queryInterface.removeColumn('monitoramento_medicamentos', 'motivo_pausa_medicamento_id');
    await queryInterface.removeColumn('monitoramento_medicamentos', 'data_pausa_fim_prevista');
    await queryInterface.removeColumn('monitoramento_medicamentos', 'data_pausa_inicio');
    // Não é possível remover um valor de enum no Postgres sem recriar o
    // tipo inteiro — deixado como está no rollback (não quebra nada, só
    // fica um valor 'PAUSADO' não utilizado no enum).
  }
};
