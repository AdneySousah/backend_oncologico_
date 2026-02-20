'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.createTable('entrevista_profissional', {
       id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
       },
       nome:{
        type: Sequelize.STRING,
        allowNull: false,
       },
       crm:{
        type: Sequelize.STRING,
        allowNull: false,
       },
       estadiamento: {
        type: Sequelize.ENUM('I', 'II', 'III', 'IV'),
        allowNull: false,
       },
       data_contato:{
        type: Sequelize.DATEONLY,
        allowNull: false,
       },
       observacoes: {
        type: Sequelize.TEXT,
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

  async down (queryInterface, Sequelize) {
     await queryInterface.dropTable('entrevista_profissional');
     
  }
};
