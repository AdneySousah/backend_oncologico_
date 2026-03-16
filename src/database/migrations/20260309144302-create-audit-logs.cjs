'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('audit_logs', {
      id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
      },
      user_id: {
        type: Sequelize.INTEGER,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL', // Se o usuário for apagado, o log não some, fica null
        allowNull: true,
      },
      action_type: {
        type: Sequelize.STRING,
        allowNull: false,
        // Sugestão de tipos: 'Criação', 'Edição', 'Exclusão', 'Emissão', 'Envio', 'Acesso'
      },
      entity: {
        type: Sequelize.STRING,
        allowNull: false,
        // Ex: 'Paciente', 'Monitoramento', 'Dashboard', 'Termo', 'Avaliação'
      },
      entity_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      details: {
        type: Sequelize.TEXT, // Usamos TEXT para caber descrições maiores ou até JSON stringificado
        allowNull: true,
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

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('audit_logs');
  }
};