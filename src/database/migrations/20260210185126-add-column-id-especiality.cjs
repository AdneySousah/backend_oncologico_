'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.addColumn('oncology_professionals', 'especiality_id',
       { type: Sequelize.INTEGER
        , references: { model: 'specialities', key: 'id' }
        , onUpdate: 'CASCADE'
        , onDelete: 'SET NULL'
        , allowNull: true
        });
 
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.removeColumn('oncology_professionals', 'especiality_id');
   
  }
};
