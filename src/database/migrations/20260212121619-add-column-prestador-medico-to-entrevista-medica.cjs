'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.addColumn('entrevista_profissional','prestador_medico_id',{
      type: Sequelize.INTEGER,
      allowNull: true,
      references: {
        model: 'prestador_medico',
        key: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });
     
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.removeColumn('entrevista_profissional', 'prestador_medico_id');

  }
};
