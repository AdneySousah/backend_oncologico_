'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('exames', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      possui_exame: {
        type: Sequelize.BOOLEAN,
        allowNull: false
      },
      prestador_medico_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'prestador_medico',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
      },
      nome_exame: {
        type: Sequelize.STRING,
        allowNull: true
      },
      tipo_exame: {
        type: Sequelize.ENUM('sangue', 'imagem', 'biópsia', 'outro'),
        allowNull: true
      },

      resultado_exame: {
        type: Sequelize.STRING,
        allowNull: true
      },
      data_exame_realizado: {
        type: Sequelize.DATEONLY,
        allowNull: true
      },
      data_exame_resultado: {
        type: Sequelize.DATEONLY,
      },
      created_at: {
        allowNull: false,
        type: Sequelize.DATE
      },
      updated_at: {
        allowNull: false,
        type: Sequelize.DATE
      }
    });

  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('exames');

  }
};
