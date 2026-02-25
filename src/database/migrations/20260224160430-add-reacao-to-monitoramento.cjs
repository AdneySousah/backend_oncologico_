'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('monitoramento_medicamentos', 'reacao_adversa_id', {
      type: Sequelize.INTEGER,
      references: { model: 'reacao_adversa', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL', // Se a reação for deletada, o monitoramento não é perdido, apenas o ID fica nulo
      allowNull: true,
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('monitoramento_medicamentos', 'reacao_adversa_id');
  }
};