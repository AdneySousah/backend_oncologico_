'use strict';

// ACUMULAR SOBRAS: em esquemas cíclicos (ex.: 6 comp. por 14 dias, pausa 7) a
// caixa não fecha ciclos inteiros e o paciente acumula comprimidos de uma caixa
// para a outra. Por padrão a caixa nova SUBSTITUI o estoque (sobra desconsiderada);
// com "acumula_sobras" marcado no medicamento do paciente, a sobra confirmada no
// contato é somada à caixa nova (qtd_sobra_anterior entra em qtd_total_capsulas).
// Cada vez que alguém marca/desmarca fica registrado em monitoramento_acumulo_historico.
module.exports = {
  up: async (queryInterface, Sequelize) => {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      await queryInterface.addColumn('monitoramento_medicamentos', 'acumula_sobras', {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment: 'Sobra da caixa anterior é somada à caixa nova nas reposições deste medicamento'
      }, { transaction });
      await queryInterface.addColumn('monitoramento_medicamentos', 'qtd_sobra_anterior', {
        type: Sequelize.INTEGER,
        allowNull: true,
        comment: 'Comprimidos da caixa anterior somados ao total deste ciclo (já incluídos em qtd_total_capsulas)'
      }, { transaction });

      await queryInterface.createTable('monitoramento_acumulo_historico', {
        id: { type: Sequelize.INTEGER, allowNull: false, autoIncrement: true, primaryKey: true },
        paciente_id: {
          type: Sequelize.INTEGER, allowNull: false,
          references: { model: 'pacientes', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE'
        },
        monitoramento_id: {
          type: Sequelize.INTEGER, allowNull: true,
          references: { model: 'monitoramento_medicamentos', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL'
        },
        medicamento_id: {
          type: Sequelize.INTEGER, allowNull: true,
          references: { model: 'medicamentos', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL'
        },
        user_id: {
          type: Sequelize.INTEGER, allowNull: true,
          references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL'
        },
        ativado: { type: Sequelize.BOOLEAN, allowNull: false },
        motivo: { type: Sequelize.TEXT, allowNull: true },
        created_at: { type: Sequelize.DATE, allowNull: false },
        updated_at: { type: Sequelize.DATE, allowNull: false }
      }, { transaction });
      await queryInterface.addIndex('monitoramento_acumulo_historico', ['paciente_id', 'created_at'], { transaction });

      await transaction.commit();
    } catch (erro) {
      await transaction.rollback();
      throw erro;
    }
  },

  down: async (queryInterface) => {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      await queryInterface.dropTable('monitoramento_acumulo_historico', { transaction });
      await queryInterface.removeColumn('monitoramento_medicamentos', 'qtd_sobra_anterior', { transaction });
      await queryInterface.removeColumn('monitoramento_medicamentos', 'acumula_sobras', { transaction });
      await transaction.commit();
    } catch (erro) {
      await transaction.rollback();
      throw erro;
    }
  }
};
