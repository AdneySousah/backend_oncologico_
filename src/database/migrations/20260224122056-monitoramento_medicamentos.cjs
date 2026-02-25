'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    return queryInterface.createTable('monitoramento_medicamentos', {
      id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
      },
      paciente_id: {
        type: Sequelize.INTEGER,
        references: { model: 'pacientes', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
        allowNull: false,
      },
      entrevista_profissional_id: {
        type: Sequelize.INTEGER,
        references: { model: 'entrevista_profissional', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
        allowNull: true,
      },
      patient_evaluation_id: {
        type: Sequelize.INTEGER,
        references: { model: 'patient_evaluations', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
        allowNull: true,
      },
      medicamento_id: {
        type: Sequelize.INTEGER,
        references: { model: 'medicamentos', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
        allowNull: false,
      },
      posologia_diaria: {
        type: Sequelize.INTEGER,
        allowNull: false,
        comment: 'Quantidade de comprimidos por dia',
      },
      data_calculada_fim_caixa: {
        type: Sequelize.DATEONLY,
        allowNull: false,
      },
      data_proximo_contato: {
        type: Sequelize.DATEONLY,
        allowNull: false,
      },
      status: {
        type: Sequelize.ENUM('PENDENTE', 'CONCLUIDO', 'CANCELADO'),
        defaultValue: 'PENDENTE',
        allowNull: false,
      },
      // Campos preenchidos no dia da ligação (follow-up)
      tomando_corretamente: {
        type: Sequelize.BOOLEAN,
        allowNull: true,
      },
      qtd_informada_caixa: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      data_abertura_nova_caixa: {
        type: Sequelize.DATEONLY,
        allowNull: true,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
    });
  },

  down: async (queryInterface) => {
    return queryInterface.dropTable('monitoramento_medicamentos');
  },
};