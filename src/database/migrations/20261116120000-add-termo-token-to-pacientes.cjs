'use strict';

// O link público do termo era /paciente/termo/<id do paciente>: qualquer pessoa podia
// trocar o número e ver (PDF com nome/CPF) ou responder o termo de outro paciente.
// Agora cada envio usa um token aleatório guardado aqui; o id deixa de abrir o termo.
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('pacientes', 'termo_token', {
      type: Sequelize.STRING(64),
      allowNull: true,
      unique: true,
      comment: 'Token aleatório do link público do termo (gerado no envio, apagado ao cancelar)'
    });
  },

  down: async (queryInterface) => {
    await queryInterface.removeColumn('pacientes', 'termo_token');
  }
};
