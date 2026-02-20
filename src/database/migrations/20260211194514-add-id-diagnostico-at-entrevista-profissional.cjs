'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.addColumn('entrevista_profissional','diagnostico_id',{
      type: Sequelize.INTEGER,
      allowNull: true,
      references: {
        model: 'diagnostico_cid',
        key: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });
     
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.removeColumn('entrevista_profissional', 'diagnostico_id');

  }
};
