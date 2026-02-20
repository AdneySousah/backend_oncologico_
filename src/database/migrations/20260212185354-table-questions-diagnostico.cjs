'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('questoes_diagnosticos', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      pergunta: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      is_pontuacao: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
      },
      pontuacao: {
        type: Sequelize.INTEGER,
        allowNull: true,
      }

    });

  },

  async down(queryInterface) {
    await queryInterface.dropTable('questoes_diagnosticos');

  }
};
