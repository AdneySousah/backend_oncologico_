'use strict';

// Semeia a Versão 1 do termo com o texto que já estava fixo no código
// (gerarTermoPdf.js), e vincula a ela todo paciente que já tinha aceitado
// o termo antes desse versionamento existir — é o texto real que eles
// viram na hora do aceite, então a vinculação é fiel.
module.exports = {
  up: async (queryInterface) => {
    const conteudoV1 = {
      introducao: 'declaro estar ciente e de acordo com o acompanhamento realizado pela equipe de navegação da {OPERADORA}.',
      textoAutorizacao: 'Autorizo o contato da equipe por meio do aplicativo WhatsApp, utilizando o número telefônico informado por mim, para fins de:',
      finalidades: [
        'Confirmação de dados e procedimentos;',
        'Envio de orientações assistenciais e administrativas;',
        'Solicitação e recebimento de documentos;',
        'Acompanhamento do tratamento e navegação do paciente;',
        'Informações relacionadas às autorizações junto à operadoras de saúde (Convênio);',
        'Esclarecimento de dúvidas pertinentes ao atendimento.'
      ],
      textoCiente: 'Declaro estar ciente de que:',
      itensCiente: [
        'O WhatsApp será utilizado exclusivamente para comunicações relacionadas ao meu atendimento;',
        'As mensagens poderão conter informações pessoais e assistenciais necessárias para continuidade do cuidado;',
        'Posso revogar esta autorização a qualquer momento, mediante solicitação formal à clínica;',
        'A instituição adota medidas de confidencialidade e proteção de dados, em conformidade com a Lei Geral de Proteção de Dados (LGPD – Lei nº 13.709/2018).'
      ]
    };

    const [versao] = await queryInterface.sequelize.query(
      `INSERT INTO versoes_termo (titulo, conteudo, ativo, created_at, updated_at)
       VALUES ('TERMO DE ACEITE PARA NAVEGAÇÃO E CONTATO VIA WHATSAPP', :conteudo, true, now(), now())
       RETURNING id;`,
      { replacements: { conteudo: JSON.stringify(conteudoV1) } }
    );
    const versaoId = versao[0].id;

    await queryInterface.sequelize.query(
      `UPDATE pacientes SET termo_versao_id = :versaoId WHERE status_termo = 'Aceito';`,
      { replacements: { versaoId } }
    );
  },

  down: async (queryInterface) => {
    await queryInterface.sequelize.query(`UPDATE pacientes SET termo_versao_id = NULL;`);
    await queryInterface.sequelize.query(`DELETE FROM versoes_termo;`);
  }
};
