'use strict';

// Versionamento do texto do termo de aceite. Em vez de o texto ficar fixo no
// código (e mudar retroativamente pra todo mundo se um dia for editado),
// cada versão fica registrada aqui, e cada paciente que aceita o termo
// guarda a QUAL versão ele aceitou (pacientes.termo_versao_id). O PDF
// continua sendo gerado ao vivo (sem salvar arquivo), mas sempre a partir
// do texto que o paciente realmente viu na hora do aceite — não do texto
// mais recente, se esse tiver mudado depois.
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('versoes_termo', {
      id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
      },
      titulo: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: 'TERMO DE ACEITE PARA NAVEGAÇÃO E CONTATO VIA WHATSAPP',
      },
      // Conteúdo estruturado (JSON), pra o gerador de PDF renderizar sem
      // precisar de texto solto misturado com lógica de formatação.
      conteudo: {
        type: Sequelize.JSONB,
        allowNull: false,
      },
      // Só uma versão pode estar ativa por vez — é ela que é usada pra
      // pré-visualização (antes do aceite) e pra todo aceite novo.
      ativo: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      criado_por: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
    });

    await queryInterface.removeColumn('pacientes', 'termo_versao');
    await queryInterface.addColumn('pacientes', 'termo_versao_id', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: 'versoes_termo', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('pacientes', 'termo_versao_id');
    await queryInterface.addColumn('pacientes', 'termo_versao', {
      type: Sequelize.STRING,
      allowNull: true,
    });
    await queryInterface.dropTable('versoes_termo');
  }
};
