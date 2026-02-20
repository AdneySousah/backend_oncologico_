'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
   await queryInterface.createTable('infos_comorbidade', 
    {
      id:{
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      possui_comorbidade:{
        type: Sequelize.BOOLEAN,
        allowNull: false
      },
      descricao_comorbidade:{
        type: Sequelize.STRING,
        allowNull: true
      },
      sabe_diagnostico:{
        type: Sequelize.BOOLEAN,
        allowNull: false
      },
      descricao_diagnostico:{
        type: Sequelize.STRING,
        allowNull: true
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

  async down (queryInterface, Sequelize) {
     await queryInterface.dropTable('infos_comorbidade');

  }
};
