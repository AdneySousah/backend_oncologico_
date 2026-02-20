'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.addColumn('entrevista_profissional', 'exame_id', { 
      type: Sequelize.INTEGER,
      references: {
        model: 'exames',
        key: 'id'
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL'
    });

    await queryInterface.addColumn('entrevista_profissional', 'infos_comorbidades_id', { 
      type: Sequelize.INTEGER,
      references: {
        model: 'infos_comorbidade',
        key: 'id'
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL'
    });
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.removeColumn('entrevista_profissional', 'exame_id');
    await queryInterface.removeColumn('entrevista_profissional', 'infos_comorbidades_id');
  }
};
