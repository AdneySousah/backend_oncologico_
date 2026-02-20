'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('evaluation_answers', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      evaluation_id: {
        type: Sequelize.INTEGER,
        references: { model: 'patient_evaluations', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
        allowNull: false,
      },
      question_id: {
        type: Sequelize.INTEGER,
        references: { model: 'evaluation_questions', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      option_selected_id: { // Se for multipla escolha
        type: Sequelize.INTEGER,
        references: { model: 'evaluation_options', key: 'id' },
        allowNull: true,
      },
      text_answer: { // Se for texto aberto
        type: Sequelize.TEXT,
        allowNull: true,
      },
      computed_score: { // Snapshot da pontuação
        type: Sequelize.INTEGER,
        defaultValue: 0,
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

  async down(queryInterface) {
    await queryInterface.dropTable('evaluation_answers');
  }
};