'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
     await queryInterface.addColumn('patient_evaluations', 'entrevista_profissional_id', {
       type: Sequelize.INTEGER,
       allowNull: false,
       references: {
        model: 'entrevista_profissional',
        key: 'id',
       },
       onUpdate: 'CASCADE',
       onDelete: 'CASCADE',
      
      });
    
  },

  async down (queryInterface, Sequelize) {
     await queryInterface.removeColumn('patient_evaluations', 'entrevista_profissional_id');
    
  }
};
