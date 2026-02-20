'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.addColumn('entrevista_profissional', 'paciente_id', {
       type: Sequelize.INTEGER,
       allowNull: false,
       references: {
        model: 'pacientes',
        key: 'id',
       },
       onUpdate: 'CASCADE',
       onDelete: 'CASCADE',
      
      });
    
  },

  async down (queryInterface, Sequelize) {
     await queryInterface.removeColumn('entrevista_profissional', 'paciente_id');
    
  }
};
