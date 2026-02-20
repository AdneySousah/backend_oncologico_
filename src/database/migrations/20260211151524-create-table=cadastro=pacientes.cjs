'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
     await queryInterface.createTable('pacientes', { 
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
      sobrenome:{
        type: Sequelize.STRING,
        allowNull: false
      },
      celular:{
        type: Sequelize.STRING,
        allowNull: false
      },
      telefone:{
        type: Sequelize.STRING,
        defaultValue: null
      },
      data_nascimento:{
        type: Sequelize.DATE,
        allowNull: false
      },
      sexo:{
        type: Sequelize.ENUM('M', 'F','nao definido'),
        allowNull: false
      },
      possui_cuidador:{
        type: Sequelize.BOOLEAN,
        allowNull: false
      },
      nome_cuidador:{
        type: Sequelize.STRING,
        defaultValue: null
      },
      contato_cuidador:{
        type: Sequelize.STRING,
        defaultValue: null
      },
      cep:{
        type: Sequelize.STRING,
      },
      logradouro:{
        type: Sequelize.STRING,
      },
      numero:{
        type: Sequelize.STRING,
      },
      complemento:{
        type: Sequelize.STRING,
        defaultValue: null
      },
      bairro:{
        type: Sequelize.STRING,
      },
      cidade:{
        type: Sequelize.STRING,
      },
      estado:{
        type: Sequelize.STRING,
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
     await queryInterface.dropTable('pacientes');
   
  }
};
