'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.createTable('operadoras', 
      { 
        id: {
          type: Sequelize.INTEGER,
          allowNull: false,
          autoIncrement: true,
          primaryKey: true
        },
        nome:{
          type: Sequelize.STRING,
          allowNull: false
        },
        cnpj:{
          type: Sequelize.STRING,
          allowNull: false
        },
        telefone:{
          type: Sequelize.STRING,
          allowNull: false
        },
        email:{
          type: Sequelize.JSONB,
          allowNull: false
        },
        created_at:{
          type: Sequelize.DATE,
          allowNull: false,
          
        },
        updated_at:{
          type: Sequelize.DATE,
          allowNull: false,
        } 
      
      });
    
  },

  async down (queryInterface, Sequelize) {
     await queryInterface.dropTable('operadoras');
     
  }
};
