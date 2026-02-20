'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
     await queryInterface.addColumn('patient_evaluations', 'data_proxima_consulta',{
      type: Sequelize.DATEONLY,
      allowNull: true,
     });

     await queryInterface.addColumn('patient_evaluations', 'consulta',{
      type: Sequelize.STRING,
      allowNull: true,
     });
     await queryInterface.addColumn('patient_evaluations', 'observacoes',{
      type: Sequelize.TEXT,
      allowNull: true,
     });
     await queryInterface.addColumn('patient_evaluations', 'data_proximo_contato',{
      type: Sequelize.DATEONLY,
      allowNull: true,
     });
    
  },

  async down (queryInterface, Sequelize) {
     await queryInterface.removeColumn('patient_evaluations', 'data_proxima_consulta');
     await queryInterface.removeColumn('patient_evaluations', 'consulta');
     await queryInterface.removeColumn('patient_evaluations', 'observacoes');
     await queryInterface.removeColumn('patient_evaluations', 'data_proximo_contato');
  }
};
