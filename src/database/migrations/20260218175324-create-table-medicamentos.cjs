'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
     Example:
      await queryInterface.createTable('medicamentos', {
         id: {
            allowNull: false,
            autoIncrement: true,
            primaryKey: true,
            type: Sequelize.INTEGER
          },
          nome: {
            type: Sequelize.STRING,
            allowNull: false
          },
          dosagem: {
            type: Sequelize.STRING,
            allowNull: false
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
    await queryInterface.dropTable('medicamentos');
    
  }
};
