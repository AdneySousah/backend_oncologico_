'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // 1. Remove a coluna antiga (pois agora será uma relação N:N em outra tabela)
    await queryInterface.removeColumn('monitoramento_medicamentos', 'reacao_adversa_id');

    // 2. Cria a tabela intermediária
    await queryInterface.createTable('monitoramento_reacoes_adversas', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      monitoramento_id: {
        type: Sequelize.INTEGER,
        references: { model: 'monitoramento_medicamentos', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
        allowNull: false,
      },
      reacao_adversa_id: {
        type: Sequelize.INTEGER,
        references: { model: 'reacao_adversa', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
        allowNull: false,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
      }
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('monitoramento_reacoes_adversas');
    await queryInterface.addColumn('monitoramento_medicamentos', 'reacao_adversa_id', {
      type: Sequelize.INTEGER,
      references: { model: 'reacao_adversa', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });
  }
};